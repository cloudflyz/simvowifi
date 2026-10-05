import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ctl (Flask) serves the built app from webui/dist on the same origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  // 本地开发：把 /api 代理到正在运行的 ctl（simvowifi web，默认 8080）。
  // 可用 SIMVOWIFI_DEV_API 覆盖，如 https://gateway-host:8080
  server: {
    proxy: {
      '/api': { target: process.env.SIMVOWIFI_DEV_API || 'http://localhost:8080', changeOrigin: true, secure: false },
    },
  },
})
