import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'

// ctl (Flask) serves the built app from webui/dist on the same origin.
// 本地开发：启用 HTTPS（自签名证书），代理 /api 到 Flask HTTPS 后端。
// 证书路径：data/certs/certificate.crt + certificate.key
const certsDir = '/root/simvowifi/data/certs'
const hasCerts = fs.existsSync(`${certsDir}/certificate.crt`) && fs.existsSync(`${certsDir}/certificate.key`)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // 本地开发启用 HTTPS（clipboard API 需要 secure context）
    https: hasCerts ? {
      key: fs.readFileSync(`${certsDir}/certificate.key`),
      cert: fs.readFileSync(`${certsDir}/certificate.crt`),
    } : undefined,
    proxy: {
      '/api': {
        target: 'https://localhost:8080',
        changeOrigin: true,
        secure: false,  // 跳过自签名证书验证
      },
    },
  },
})
