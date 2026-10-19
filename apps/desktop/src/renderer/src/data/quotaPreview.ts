import type { AccountQuota } from '@pixelsky/protocol'

/** 仅用于设置里额度按钮的预览（示例数据），不读取也不写入真实额度。 */
const sample: Omit<AccountQuota, 'windows' | 'extras'> = {
  provider: 'claude',
  status: 'ok',
  plan: 'max',
  account: null,
  blocked: null,
  observedAt: null,
  fetchedAt: null,
  source: 'demo',
  refreshable: true,
  error: null,
}

/** 平时的样子：5 小时 42%，本周 18%，本周 Opus 61%（按钮写「周 61%」） */
export const quotaPreviewNormal: AccountQuota = {
  ...sample,
  windows: [
    { id: 'five_hour', durationMins: 300, usedPercent: 42, resetsAt: null },
    { id: 'seven_day', durationMins: 10_080, usedPercent: 18, resetsAt: null },
  ],
  extras: { models: [{ name: 'Opus', durationMins: 10_080, usedPercent: 61, resetsAt: null }] },
}

/** 「快用完时才显示」选中后出现的样子：5 小时 86%（橙色） */
export const quotaPreviewNear: AccountQuota = {
  ...sample,
  windows: [
    { id: 'five_hour', durationMins: 300, usedPercent: 86, resetsAt: null },
    { id: 'seven_day', durationMins: 10_080, usedPercent: 39, resetsAt: null },
  ],
  extras: {},
}
