import React, { useCallback, useEffect, useRef, useState } from 'react'

type HistoryTurn = { role: 'user' | 'model', parts: { text: string }[] }

const App: React.FC = () => {
  const [listening, setListening] = useState(false)
  const [recognizing, setRecognizing] = useState(false)
  const [userText, setUserText] = useState('')
  const [answer, setAnswer] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState('gemini-2.5-flash')
  const [useOpenAI, setUseOpenAI] = useState(true)

  const historyRef = useRef<HistoryTurn[]>([])
  const controllerRef = useRef<AbortController | null>(null)
  const recognitionRef = useRef<any>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)

  const startingRef = useRef(false)

  // ✅ 전역 큐 상태
  const allSentencesRef = useRef<string[]>([])
  const ttsStartedRef = useRef(false)
  const audioCacheRef = useRef(new Map<number, { audio: HTMLAudioElement, url: string }>())
  const loadingPromisesRef = useRef(new Map<number, Promise<void>>())
  const currentSentenceIndexRef = useRef(0)

  const clearAudioQueue = () => {
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause()
        currentAudioRef.current.src = ''
      } catch {}
      currentAudioRef.current = null
    }
    window.speechSynthesis.cancel()
    setSpeaking(false)

    audioCacheRef.current.forEach(({ url }) => URL.revokeObjectURL(url))
    audioCacheRef.current.clear()
    loadingPromisesRef.current.clear()
    allSentencesRef.current = []
    ttsStartedRef.current = false
    currentSentenceIndexRef.current = 0
  }

  const stopListening = useCallback(() => {
    setListening(false)
    try { recognitionRef.current?.stop?.() } catch {}
    clearAudioQueue()
  }, [])

  const chat = useCallback(async (text: string) => {
    setError(null)
    setAnswer('')
    controllerRef.current?.abort()
    controllerRef.current = new AbortController()

    clearAudioQueue()

    const history = historyRef.current
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: controllerRef.current.signal,
      body: JSON.stringify({ history, userText: text, model })
    }).catch((e) => {
      setError('요청 실패: ' + e.message)
      return null
    })
    if (!res || !res.body) return

    historyRef.current = [...historyRef.current, { role: 'user', parts: [{ text }] }]

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let firstChunk = true
    let accumulated = ''
    let fullResponse = ''

    const cleanTextForTTS = (text: string) => {
      return text
        .replace(/\*+/g, '')
        .replace(/#+/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]*`/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/:\s*/g, ': ')
        .trim()
    }

    const splitIntoSentences = (text: string): string[] => {
      const cleanedText = cleanTextForTTS(text)
      const sentences: string[] = []
      let current = ''

      for (let i = 0; i < cleanedText.length; i++) {
        const char = cleanedText[i]
        current += char

        if (/[.!?]/.test(char)) {
          const nextChar = cleanedText[i + 1] || ''
          const isBoundary =
            !nextChar ||
            nextChar === ' ' ||
            nextChar === '\n' ||
            /[가-힣A-Z]/.test(nextChar)

          if (isBoundary) {
            const trimmed = current.trim()
            if (trimmed.length > 0) {
              sentences.push(trimmed)
              current = ''
            }
          }
        }
      }

      return sentences
    }

    const preloadAudio = async (index: number, sentence: string) => {
      const audioCache = audioCacheRef.current
      const loadingPromises = loadingPromisesRef.current

      if (audioCache.has(index) || loadingPromises.has(index)) return

      const loadPromise = (async () => {
        try {
          if (useOpenAI) {
            const response = await fetch('/api/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ text: sentence, voice: 'alloy' })
            })

            if (response.ok) {
              const audioBlob = await response.blob()
              const audioUrl = URL.createObjectURL(audioBlob)
              const audio = new Audio(audioUrl)

              await new Promise<void>((resolve, reject) => {
                audio.oncanplaythrough = () => resolve()
                audio.onerror = reject
                audio.load()
              })

              audioCache.set(index, { audio, url: audioUrl })
            }
          }
        } catch {}
      })()

      loadingPromises.set(index, loadPromise)
      await loadPromise
      loadingPromises.delete(index)
    }

    const playPreloadedAudio = async (index: number) => {
      const audioCache = audioCacheRef.current
      const allSentences = allSentencesRef.current

      if (useOpenAI) {
        let waitCount = 0
        const maxWait = 40

        while (!audioCache.has(index) && waitCount < maxWait) {
          if (!loadingPromisesRef.current.has(index) && allSentences[index]) {
            preloadAudio(index, allSentences[index])
          }
          await new Promise(resolve => setTimeout(resolve, 500))
          waitCount++
        }

        let cached = audioCache.get(index)

        if (!cached && allSentences[index]) {
          try {
            const response = await fetch('/api/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ text: allSentences[index], voice: 'alloy' })
            })
            if (response.ok) {
              const audioBlob = await response.blob()
              const audioUrl = URL.createObjectURL(audioBlob)
              const audio = new Audio(audioUrl)
              cached = { audio, url: audioUrl }
              audioCache.set(index, cached)
            }
          } catch {}
        }

        if (!cached) {
          playNextSentence(index + 1)
          return
        }

        const { audio } = cached
        currentAudioRef.current = audio
        setSpeaking(true)
        currentSentenceIndexRef.current = index

        audio.onended = () => {
          setSpeaking(false)
          currentAudioRef.current = null
          playNextSentence(index + 1)
        }

        try {
          audio.currentTime = 0
          await audio.play()
        } catch {
          setSpeaking(false)
          playNextSentence(index + 1)
        }
      } else {
        const sentence = allSentences[index]
        if (sentence) {
          const utter = new SpeechSynthesisUtterance(sentence)
          utter.lang = 'ko-KR'
          utter.rate = 1.0
          utter.onend = () => {
            setSpeaking(false)
            playNextSentence(index + 1)
          }
          window.speechSynthesis.speak(utter)
          currentSentenceIndexRef.current = index
        } else {
          playNextSentence(index + 1)
        }
      }
    }

    const playNextSentence = (nextIndex: number) => {
      const allSentences = allSentencesRef.current
      if (nextIndex < allSentences.length && allSentences[nextIndex]) {
        if (useOpenAI) {
          for (let i = nextIndex; i < Math.min(allSentences.length, nextIndex + 4); i++) {
            if (!audioCacheRef.current.has(i) && !loadingPromisesRef.current.has(i)) {
              preloadAudio(i, allSentences[i])
            }
          }
        }
        setTimeout(() => playPreloadedAudio(nextIndex), 200)
      }
    }

    const updateSentencesAndPreload = async () => {
      const newSentences = splitIntoSentences(accumulated)
      const previousLength = allSentencesRef.current.length
      allSentencesRef.current = newSentences

      if (useOpenAI) {
        for (let i = previousLength; i < newSentences.length; i++) {
          if (i <= currentSentenceIndexRef.current + 3) {
            preloadAudio(i, newSentences[i])
          }
        }
      }

      if (!ttsStartedRef.current && newSentences.length > 0) {
        ttsStartedRef.current = true
        if (useOpenAI) playPreloadedAudio(0)
        else {
          const utter = new SpeechSynthesisUtterance(newSentences[0])
          utter.lang = 'ko-KR'
          utter.rate = 1.0
          utter.onend = () => {
            setSpeaking(false)
            playNextSentence(1)
          }
          window.speechSynthesis.speak(utter)
          setSpeaking(true)
        }
      }
    }

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })

        if (firstChunk && chunk.startsWith('[error]')) {
          setError(chunk)
          break
        }
        firstChunk = false

        setAnswer(prev => {
          const newAnswer = prev + chunk
          fullResponse = newAnswer
          return newAnswer
        })
        accumulated += chunk

        if (accumulated.length > 15) {
          updateSentencesAndPreload()
        }
      }
    } finally {
      if (accumulated) {
        updateSentencesAndPreload()
      }
    }

    historyRef.current = [...historyRef.current, { role: 'model', parts: [{ text: fullResponse.trim() }] }]
  }, [model, useOpenAI])

  const startListening = useCallback(async () => {
    if (startingRef.current) return
    startingRef.current = true

    controllerRef.current?.abort()
    fetch('/api/abort', { method: 'POST', credentials: 'include' }).catch(() => {})

    clearAudioQueue()

    setError(null)
    setAnswer('')

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: any) {
      setError('마이크 권한 필요: ' + (e.message || 'denied'))
      startingRef.current = false
      return
    }

    if (useOpenAI) {
      setListening(true)
      setRecognizing(true)
      setUserText('녹음 중...')

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
        const chunks: Blob[] = []

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data)
        }

        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => track.stop())

          if (chunks.length > 0) {
            const audioBlob = new Blob(chunks, { type: 'audio/webm' })
            const formData = new FormData()
            formData.append('audio', audioBlob, 'recording.webm')

            try {
              const response = await fetch('/api/stt', {
                method: 'POST',
                credentials: 'include',
                body: formData
              })

              if (response.ok) {
                const result = await response.json()
                setUserText(result.text)
                if (result.text.trim()) {
                  chat(result.text)
                }
              } else {
                setError('음성 인식 실패')
              }
            } catch (e: any) {
              setError('음성 인식 오류: ' + e.message)
            }
          }

          setListening(false)
          setRecognizing(false)
          startingRef.current = false
        }

        mediaRecorder.start()

        setTimeout(() => {
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop()
          }
        }, 5000)
      } catch (e: any) {
        setError('녹음 시작 실패: ' + e.message)
        setListening(false)
        setRecognizing(false)
        startingRef.current = false
      }
    } else {
      const SR: any = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
      if (!SR) {
        setError('이 브라우저는 Web Speech API를 지원하지 않습니다.')
        startingRef.current = false
        return
      }

      const rec = new SR()
      recognitionRef.current = rec
      rec.lang = 'ko-KR'
      rec.interimResults = true
      rec.continuous = false
      let interim = ''
      setListening(true)
      setRecognizing(true)
      setUserText('')

      let finalResult = ''

      rec.onresult = (ev: any) => {
        interim = ''
        finalResult = ''
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript
          if (ev.results[i].isFinal) finalResult += t
          else interim += t + ' '
        }
        const combined = (finalResult || interim || '').trim()
        setUserText(combined)
      }

      rec.onend = () => {
        setListening(false)
        setRecognizing(false)
        startingRef.current = false
        const finalSpeech = (finalResult || interim).trim()
        if (finalSpeech) chat(finalSpeech)
      }

      rec.onerror = (e: any) => {
        setError('음성 인식 오류: ' + (e.error || 'unknown'))
        setListening(false)
        setRecognizing(false)
        startingRef.current = false
      }

      try { rec.start() } catch (e: any) {
        setError('음성 인식 시작 실패: ' + (e.message || 'start error'))
        setListening(false)
        setRecognizing(false)
        startingRef.current = false
      }
    }
  }, [chat, useOpenAI])

  useEffect(() => {
    if (listening) {
      controllerRef.current?.abort()
      fetch('/api/abort', { method: 'POST', credentials: 'include' }).catch(() => {})
      clearAudioQueue()
    }
  }, [listening])

  return (
    <div className="container">
      <div className="header">
        <div className="title">Voice Gemini</div>
        <div className="pill">Google Search grounding + Streaming</div>
        <div className="toggleRow">
          <label className="toggle">
            <input
              type="checkbox"
              checked={useOpenAI}
              onChange={(e) => setUseOpenAI(e.target.checked)}
            />
            <span className="slider"></span>
            <span className="label">OpenAI TTS/STT</span>
          </label>
        </div>
      </div>

      <div className="micRow">
        <div className="moonWrap" aria-hidden>
          <div className="moon"></div>
          {listening && (<>
            <div className="glow"></div>
            <div className="wave"></div>
            <div className="wave w2"></div>
            <div className="wave w3"></div>
            <div className="crater c1"></div>
            <div className="crater c2"></div>
          </>)}
        </div>
        {!recognizing ? (
          <button className="btn" onClick={startListening}>🎙️ Start Talking</button>
        ) : (
          <button className="btn" onClick={stopListening}>⏹️ Stop</button>
        )}
      </div>

      <div className="bottom">
        <div>
          <div className="label">You said</div>
          <div className="box">{userText || <span className="small">말씀해 주세요…</span>}</div>
        </div>
        <div>
          <div className="label">Answer</div>
          <div className="box answer">{answer || <span className="small">모델 응답이 여기에 표시됩니다.</span>}</div>
        </div>
        {error && <div className="small">⚠ {error}</div>}
      </div>
    </div>
  )
}

export default App
