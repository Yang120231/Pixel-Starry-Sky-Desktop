// 用量里没有费用的记录按原因分开（GitHub #22，docs/ui/usage.md §12）；带 {p0} 的计数标签放在 catalog，不参与动态匹配
export const costMessages = {
  'usageCost.dimension': { zh: '费用情况', en: 'Cost status' },
  'usageCost.missing': { zh: '没有费用', en: 'Cost not recorded' },
  'usageCost.known': { zh: '有费用', en: 'Has cost' },
  'usageCost.pending': { zh: '等平台结算', en: 'Awaiting settlement' },
  'usageCost.empty': { zh: '没用到 token', en: 'No tokens used' },
  'usageCost.platform': { zh: '平台账单没对上', en: 'Not matched in platform bill' },
  'usageCost.noPrice': { zh: '对不上官方价格', en: 'No official price' },
  'usageCost.engine': { zh: '引擎没报费用', en: 'Not reported by engine' },
  'usageCost.knownHint': { zh: '这些记录有费用', en: 'These records have a cost' },
  'usageCost.missingHint': { zh: '所有没有费用的记录', en: 'All records without a cost' },
  'usageCost.pendingHint': {
    zh: '平台账单还没出来，稍后会自动补上',
    en: "The platform bill isn't ready yet; the cost fills in automatically",
  },
  'usageCost.emptyHint': {
    zh: '这一轮一开始就中断或出错，没有用到 token',
    en: 'The turn stopped or failed before using any tokens',
  },
  'usageCost.platformHint': {
    zh: '像素星空账单里没对上这次扣费，不拿估算代替。登录当时用的账号后会自动按时间补录；补录也没对上的，可以在「账号调用」里核对',
    en: 'No matching charge in the PixelSky bill, and no estimate is substituted. Sign in with the account used at the time and it is backfilled by time; if that fails too, check Account requests',
  },
  'usageCost.noPriceHint': {
    zh: '这个模型对不上官方价格，只记了 token。可以在接口设置里给它选「计价参照」，之后的调用会按它估算',
    en: 'This model has no official price, so only tokens are recorded. Set a pricing reference in the endpoint settings and later calls are estimated with it',
  },
  'usageCost.engineHint': {
    zh: '引擎没报费用（例如 Codex），只记了 token',
    en: "The engine didn't report a cost (e.g. Codex); only tokens are recorded",
  },
  'usageCost.kpiMissingTitle': {
    zh: '点一下只看这些记录，分布表按原因分开',
    en: 'Show only these records, split by reason in the distribution',
  },
  'usageCost.reason': { zh: '没有费用的原因', en: 'Why no cost' },
}
