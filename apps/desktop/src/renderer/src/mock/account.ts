// 演示模式下的账号数据（--demo）。用户名和 mock/demo.ts 的 currentUser 保持一致
import type { AccountInfo } from '../../../shared/types/account'

export const demoAccount: AccountInfo = {
  name: '林夏',
  email: 'linxia@example.com',
  balance: 12.34,
  currency: 'USD',
  group: { name: 'pixelsky-pro', billingSource: 'subscription' },
  plan: {
    name: 'Pro 月卡',
    expiresAt: '2026-11-01T00:00:00Z',
    daily: { used: 1.2, limit: 10 },
    weekly: { used: 46.5, limit: 50 }, // 超过 90%，用来检查 danger 色
    monthly: { used: 88.9, limit: 150 },
  },
  rateLimits: [{ window: '5h', used: 0.5, limit: 2 }],
  updatedAt: Date.now() - 2 * 60_000,
}
