// 手机端网页版（docs/mobile-remote.md §8）。线上放在云端服务的 /m/ 下，和中转同源；
// 本机开发时 /v1/bridge 由这里转给本机云端服务（MOBILE_CLOUD，默认 http://127.0.0.1:9080），手机连电脑的局域网地址打开。
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const cloud = process.env.MOBILE_CLOUD ?? 'http://127.0.0.1:9080'

// App（Capacitor）里页面从根路径加载：`vite build --mode app`
export default defineConfig(({ mode }) => ({
  base: mode === 'app' ? '/' : '/m/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    // 不改 Host：中转按 Origin 和 Host 同源放行网页的 WebSocket
    proxy: { '/v1/bridge': { target: cloud, ws: true, changeOrigin: false } },
  },
  build: { outDir: 'dist', target: 'es2022' },
}))
