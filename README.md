````markdown
# Vite HTTPS 개발 서버 설정 가이드

본 문서는 Vite 개발 서버를 HTTPS로 실행하기 위해 **Self-Signed 인증서**를 생성하고 설정하는 방법을 설명합니다.  
인증서는 `certs/` 폴더에 생성되며, 파일명은 `server-cert.pem`, `server-key.pem` 입니다.

---

## 1. 인증서 생성

### certs 폴더 생성
```bash
mkdir certs
cd certs
````

### OpenSSL 명령어 실행

아래 명령어를 통해 개인 키와 인증서를 생성합니다.

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout server-key.pem -out server-cert.pem -days 365
```

#### 주요 옵션 설명

* `-x509` : Self-signed 인증서 생성
* `-newkey rsa:2048` : 2048비트 RSA 키 생성
* `-nodes` : 비밀번호 없는 키 생성 (Vite 서버 실행 시 필요)
* `-keyout server-key.pem` : 개인 키 파일 이름
* `-out server-cert.pem` : 인증서 파일 이름
* `-days 365` : 인증서 유효 기간 (365일)

### Common Name 입력

명령어 실행 시 아래와 같은 입력을 요구합니다.
`Common Name` 항목에는 반드시 **localhost** 를 입력하세요.

예시:

```
Country Name (2 letter code) [AU]: KR
State or Province Name (full name) [Some-State]: Seoul
Locality Name (eg, city) []: Seoul
Organization Name (eg, company) [Internet Widgits Pty Ltd]: MyCompany
Common Name (e.g. server FQDN or YOUR name) []: localhost
Email Address []:
```

---

## 2. Vite 설정

`vite.config.ts` 또는 `vite.config.js` 파일을 열고 다음과 같이 수정합니다.

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

export default defineConfig({
  plugins: [react()],
  server: {
    https: {
      key: fs.readFileSync('./certs/server-key.pem'),
      cert: fs.readFileSync('./certs/server-cert.pem'),
    },
    host: true,
    port: 7777,
  },
})
```

---

## 3. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `https://localhost:7777` 로 접속하면 HTTPS 환경에서 개발 서버가 실행됩니다.
(※ Self-signed 인증서이므로 브라우저에서 보안 경고가 나타날 수 있습니다. 이는 정상입니다.)