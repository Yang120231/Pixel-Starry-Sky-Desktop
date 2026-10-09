// 冒烟测试：用本机真实的 Claude Code 跑几轮对话（会消耗少量额度）。
// 运行：pnpm --filter @pixelsky/engine smoke
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.smoke.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
})
