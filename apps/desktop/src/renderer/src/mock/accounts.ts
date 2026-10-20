// 订阅账号多开的演示数据（docs/ui/engine-accounts.md，照样式稿 docs/ui/multi-account-mockup.html）
import type { DemoAccounts } from '@/data/demo'

const hour = 3_600_000
const now = Date.now()

export const demoAccounts: DemoAccounts = {
  list: {
    engine: 'codex',
    current: 'default',
    accounts: [
      { id: 'default', email: 'linxia@example.com', plan: 'plus', label: null, addedAt: 0, status: 'ok' },
      {
        id: 'a_0d3f9a1c2b7e',
        email: 'work@company.com',
        plan: 'team',
        label: '公司',
        addedAt: now - 30 * 24 * hour,
        status: 'ok',
      },
      {
        id: 'a_7c2e5b8d1f04',
        email: 'side@example.com',
        plan: 'pro',
        label: '备用',
        addedAt: now - 60 * 24 * hour,
        status: 'expired',
      },
    ],
    auto: { enabled: false, order: 'list', switchBack: true, notice: true },
  },
  quota: [
    {
      id: 'default',
      windows: [
        { id: 'five_hour', durationMins: 300, usedPercent: 82, resetsAt: now + 2 * hour },
        { id: 'seven_day', durationMins: 10080, usedPercent: 47, resetsAt: now + 3 * 24 * hour },
      ],
      blocked: false,
      observedAt: now,
    },
    {
      id: 'a_0d3f9a1c2b7e',
      windows: [
        { id: 'five_hour', durationMins: 300, usedPercent: 4, resetsAt: now + 4 * hour },
        { id: 'seven_day', durationMins: 10080, usedPercent: 12, resetsAt: now + 5 * 24 * hour },
      ],
      blocked: false,
      observedAt: now,
    },
  ],
}
