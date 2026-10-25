// 「从中转站读取」费用倍率（docs/ui/custom-api.md §4.3）：先试 sub2api 的 Key 计费接口，再试 new-api 的公开价格页
import { officialPrice } from '@pixelsky/protocol'
import type { RelayBilling } from '../../../shared/types/providers'
import type { ResolvedProvider } from './store'
import { classifyError, providerHeaders, redact, upstreamMessage, type Fetch } from './upstream'

const TIMEOUT = 15_000
/** new-api 的倍率 1 = $2 / 百万输入 token（QuotaPerUnit 500000 / $1 = $0.002 / 1K） */
const NEW_API_UNIT = 2

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

async function getJson(
  fetch: Fetch,
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT) })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // 不是 JSON（网页、404 页面）
  }
  return { status: res.status, json, text }
}

/** sub2api：GET /v1/sub2api/billing（API Key 认证），返回 null 表示不是 sub2api */
async function sub2api(p: ResolvedProvider, origin: string, fetch: Fetch): Promise<RelayBilling | null> {
  const r = await getJson(fetch, origin + '/v1/sub2api/billing', providerHeaders(p, { accept: 'application/json' }))
  const body = obj(r.json)
  if (r.status === 200 && body?.object === 'sub2api.key_billing') {
    const multiplier = num(body.effective_rate_multiplier)
    const base = num(body.resolved_rate_multiplier) ?? num(body.group_rate_multiplier)
    if (multiplier === null || base === null || multiplier < 0 || base < 0)
      return { kind: 'unknown', message: '中转站返回的倍率格式不对，请手动填写' }
    const peakRate = num(body.peak_rate_multiplier)
    const peak =
      body.peak_rate_enabled === true && peakRate !== null
        ? {
            start: String(body.peak_start ?? ''),
            end: String(body.peak_end ?? ''),
            multiplier: peakRate,
            active: (num(body.applied_peak_multiplier) ?? 1) !== 1,
          }
        : null
    return { kind: 'sub2api', multiplier, base, peak }
  }
  // sub2api 认出了 Key 但查不了（Key 没分到分组、简易模式）：把它的说明告诉用户
  if (
    (r.status === 403 && r.text.includes('API key is not assigned to a group')) ||
    (r.status === 404 && r.text.includes('Billing information is not supported in simple mode'))
  )
    return { kind: 'unknown', message: redact(upstreamMessage(r.text), p) }
  return null
}

/** new-api：公开的 /api/pricing（不带 Key）+ /api/status（充值单价、汇率）；返回 null 表示不是 new-api */
async function newApi(p: ResolvedProvider, origin: string, fetch: Fetch): Promise<RelayBilling | null> {
  const r = await getJson(fetch, origin + '/api/pricing', { accept: 'application/json' })
  const body = obj(r.json)
  if (!body || typeof body.success !== 'boolean') return null
  if (!body.success || r.status !== 200)
    return { kind: 'unknown', message: '这个中转站没有公开价格页（要登录才能看），请手动填写' }
  const ratios = obj(body.group_ratio) ?? {}
  const labels = obj(body.usable_group) ?? {}
  const usable = Object.keys(labels)
  const groups = Object.entries(ratios)
    .filter(([name]) => !usable.length || usable.includes(name))
    .flatMap(([name, v]) => {
      const ratio = num(v)
      return ratio === null || ratio < 0 ? [] : [{ name, label: String(labels[name] ?? '') || name, ratio }]
    })
    .sort((a, b) => a.ratio - b.ratio)
  const pricing = Array.isArray(body.data) ? body.data.map(obj).filter(Boolean) : []
  const models = p.models.map(m => {
    const row = pricing.find(x => x!.model_name === m.id)
    const ratio = row && row.quota_type === 0 ? num(row.model_ratio) : null
    const official = officialPrice(m.id, m.priceRef)
    return {
      id: m.id,
      factor: ratio !== null && official && official.input > 0 ? (ratio * NEW_API_UNIT) / official.input : null,
    }
  })
  // 充值单价和汇率读不到不影响结果
  let recharge: number | null = null
  let site: string | null = null
  try {
    const s = obj(obj((await getJson(fetch, origin + '/api/status', { accept: 'application/json' })).json)?.data)
    const price = num(s?.price)
    const rate = num(s?.usd_exchange_rate)
    if (price !== null && rate !== null && price > 0 && rate > 0) recharge = price / rate
    site = typeof s?.system_name === 'string' && s.system_name.trim() ? s.system_name.trim().slice(0, 60) : null
  } catch {
    // 忽略
  }
  return { kind: 'new-api', site, groups, models, recharge }
}

/** 读取中转站的费用倍率；认不出、没开放时返回 unknown（带原因），连不上时抛错 */
export async function relayBilling(p: ResolvedProvider, fetch: Fetch): Promise<RelayBilling> {
  // shortcut: 只看站点根地址，部署在子路径下的中转站认不出（会提示手动填写）
  const origin = new URL(p.baseUrl).origin
  // sub2api 那一步出错（不认识的路径被跳到登录页、超时）不算失败，接着试 new-api；两步都连不上才报错
  let firstError: unknown = null
  let found: RelayBilling | null = null
  try {
    found = await sub2api(p, origin, fetch)
  } catch (err) {
    firstError = err
  }
  if (found) return found
  try {
    found = await newApi(p, origin, fetch)
  } catch (err) {
    throw new Error(classifyError(firstError ?? err, origin).message)
  }
  return found ?? { kind: 'unknown', message: '认不出这个接口用的中转系统（目前认 sub2api 和 new-api），请手动填写' }
}
