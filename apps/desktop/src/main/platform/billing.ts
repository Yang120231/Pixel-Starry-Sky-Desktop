import { rangeWindow } from '@pixelsky/protocol'
import type { PlatformCharge, PlatformSettlement, RemoteCallPage, RemoteCallsQuery } from '@pixelsky/protocol'
import { platformFetch, signedInEmail } from '../account/account'

const date = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
async function query(params: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  const response = await platformFetch('/v1/oauth/usage/calls?' + params, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('暂时无法读取账号调用记录')
  }
  return response.json()
}

export async function platformCharges(settlement: PlatformSettlement, signal: AbortSignal): Promise<PlatformCharge[]> {
  if (signedInEmail() !== settlement.account) throw new Error('平台账号已退出或切换，请登录原账号后重试')
  const charges: PlatformCharge[] = []
  for (let offset = 0; offset < settlement.requests.length; offset += 100) {
    if (signedInEmail() !== settlement.account) throw new Error('平台账号已退出或切换，请登录原账号后重试')
    const params = new URLSearchParams({
      request_ids: settlement.requests
        .slice(offset, offset + 100)
        .map(r => r.chargeId ?? r.id)
        .join(','),
      start_date: date(settlement.startedAt - 86400000),
    })
    const data = (await query(params, signal)) as { charges?: PlatformCharge[] }
    if (signedInEmail() !== settlement.account || !Array.isArray(data.charges)) throw new Error('平台费用数据不可用')
    charges.push(...data.charges)
  }
  return charges
}

export async function accountCalls(value: unknown): Promise<RemoteCallPage> {
  const q = value as RemoteCallsQuery
  if (
    !q ||
    !['today', '7d', '30d', '90d'].includes(q.range) ||
    !Number.isFinite(q.now) ||
    !Number.isInteger(q.offset) ||
    q.offset < 0 ||
    q.offset > 1000000 ||
    !Number.isInteger(q.limit) ||
    q.limit < 1 ||
    q.limit > 100 ||
    (q.model !== null && (typeof q.model !== 'string' || q.model.length > 200))
  )
    throw new Error('无效的调用记录查询')
  const localDate = (ms: number): string => date(ms - new Date(ms).getTimezoneOffset() * 60000)
  const params = new URLSearchParams({
    offset: String(q.offset),
    limit: String(q.limit),
    start_date: localDate(rangeWindow(q.range, q.now).from),
    end_date: localDate(q.now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  if (q.model) params.set('model', q.model)
  const page = (await query(params, AbortSignal.timeout(25000))) as RemoteCallPage
  if (!page || !Array.isArray(page.calls) || !Number.isFinite(page.total)) throw new Error('平台费用数据不可用')
  return page
}
