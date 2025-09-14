import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 7777,
    https: {
      key: fs.readFileSync('./certs/server-key.pem'),
      cert: fs.readFileSync('./certs/server-cert.pem')
    },    
    proxy: {
      '/api': 'http://localhost:8787'
    }
  }
})
