// Claude 账号额度解析（docs/ui/account-quota.md §3.2、§7.1）：get_usage 回包和 rate_limit_event
/* eslint-disable @typescript-eslint/no-explicit-any -- 读 JSON 样本，字段随意取 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseClaudeRateLimitEvent, parseClaudeUsage, unknownControl } from '../src/claude/quota'

const fixture = <T = Record<string, any>>(name: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'))
const NOW = 1_792_000_000_000

/** 在实测样本上改几处：rate_limits 里的字段覆盖 */
function usage(patch: Record<string, unknown> = {}, top: Record<string, unknown> = {}): Record<string, any> {
  const base = fixture('claude-get-usage.json')
  return { ...base, ...top, rate_limits: { ...base.rate_limits, ...patch } }
}
function ok(raw: unknown) {
  const r = parseClaudeUsage(raw, NOW)
  if (r.kind !== 'ok') throw new Error(`expected ok, got ${r.kind}`)
  return r
}

describe('parseClaudeUsage', () => {
  it('实测样本：5 小时 4%、本周 68%、恢复时间是毫秒、Fable 0%、没有额外用量', () => {
    const r = ok(fixture('claude-get-usage.json'))
    expect(r.plan).toBe('max')
    expect(r.account).toBeNull()
    expect(r.observedAt).toBe(NOW)
    expect(r.blocked).toBeNull()
    expect(r.windows).toEqual([
      { id: 'five_hour', durationMins: 300, usedPercent: 4, resetsAt: Date.parse('2026-10-19T08:59:59.917Z') },
      { id: 'seven_day', durationMins: 10_080, usedPercent: 68, resetsAt: Date.parse('2026-10-21T06:59:59.917Z') },
    ])
    expect(r.windows[0].resetsAt).toBeGreaterThan(1_790_000_000_000)
    expect(r.extras.models).toEqual([
      { name: 'Fable', durationMins: 10_080, usedPercent: 0, resetsAt: Date.parse('2026-10-21T07:00:00Z') },
    ])
    expect(r.extras.extraUsage).toBeUndefined()
  })

  it('rate_limits_available 为 false → unsupported', () => {
    expect(parseClaudeUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null }, NOW)).toEqual(
      {
        kind: 'unsupported',
      },
    )
    expect(parseClaudeUsage({ subscription_type: 'max', rate_limits_available: false }, NOW)).toEqual({
      kind: 'unsupported',
    })
    expect(parseClaudeUsage({ subscription_type: null, rate_limits: null }, NOW)).toEqual({ kind: 'unsupported' })
  })

  it('空对象和不认识的形状 → no-request', () => {
    expect(parseClaudeUsage({}, NOW)).toEqual({ kind: 'no-request' })
    expect(parseClaudeUsage({ models: [] }, NOW)).toEqual({ kind: 'no-request' })
    expect(parseClaudeUsage(null, NOW)).toEqual({ kind: 'no-request' })
    expect(parseClaudeUsage('x', NOW)).toEqual({ kind: 'no-request' })
  })

  it('rate_limits_available 为真但 rate_limits 不是对象 → 抛错', () => {
    expect(() => parseClaudeUsage({ rate_limits_available: true, subscription_type: 'pro' }, NOW)).toThrow(
      '没有拿到额度数据',
    )
    expect(() => parseClaudeUsage({ rate_limits_available: true, rate_limits: [] }, NOW)).toThrow('没有拿到额度数据')
  })

  it('five_hour 缺失时从 limits[] 补', () => {
    const r = ok(usage({ five_hour: null }))
    expect(r.windows.find(w => w.id === 'five_hour')).toMatchObject({ usedPercent: 4, durationMins: 300 })
    const week = ok(usage({ seven_day: undefined }))
    expect(week.windows.find(w => w.id === 'seven_day')).toMatchObject({ usedPercent: 68 })
  })

  it('locked_reason 非空记 rejected', () => {
    const r = ok(
      usage({ five_hour: { utilization: 100, resets_at: '2026-10-19T08:59:59Z', locked_reason: 'rate_limited' } }),
    )
    expect(r.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 100, rejected: true })
  })

  it('只有 seven_day_opus 时出 Opus（名字写 Opus）', () => {
    const r = ok(
      usage({
        model_scoped: undefined,
        limits: [],
        seven_day_opus: { utilization: 61, resets_at: '2026-10-22T09:00:00Z' },
      }),
    )
    expect(r.extras.models).toEqual([
      { name: 'Opus', durationMins: 10_080, usedPercent: 61, resetsAt: Date.parse('2026-10-22T09:00:00Z') },
    ])
  })

  it('model_scoped 优先，和 limits[] 重复时去重；没有 model_scoped 时看 limits[] 的 weekly_scoped', () => {
    const dup = ok(usage())
    expect(dup.extras.models).toHaveLength(1)
    const twice = ok(
      usage({
        model_scoped: [
          { display_name: 'Opus', utilization: 10, resets_at: '2026-10-22T09:00:00Z' },
          { display_name: 'Opus', utilization: 10, resets_at: '2026-10-22T09:00:00Z' },
        ],
      }),
    )
    expect(twice.extras.models).toHaveLength(1)
    const fromLimits = ok(usage({ model_scoped: undefined }))
    expect(fromLimits.extras.models).toEqual([
      expect.objectContaining({ name: 'Fable', usedPercent: 0, durationMins: 10_080 }),
    ])
  })

  it('utilization 超过 100 截到 100，负数记 0，字符串 / null 不出那项', () => {
    const r = ok(
      usage({
        five_hour: { utilization: 120, resets_at: '2026-10-19T08:59:59Z' },
        seven_day: { utilization: '68', resets_at: '2026-10-21T06:59:59Z' },
        limits: [],
      }),
    )
    expect(r.windows).toEqual([expect.objectContaining({ id: 'five_hour', usedPercent: 100 })])
    const negative = ok(usage({ five_hour: { utilization: -3, resets_at: null }, seven_day: null, limits: [] }))
    expect(negative.windows).toEqual([{ id: 'five_hour', durationMins: 300, usedPercent: 0, resetsAt: null }])
    const none = ok(usage({ five_hour: { utilization: null }, seven_day: null, limits: [], model_scoped: [] }))
    expect(none.windows).toEqual([])
  })

  it('resets_at 不合法 → null', () => {
    const r = ok(usage({ five_hour: { utilization: 4, resets_at: 'tomorrow' }, seven_day: { utilization: 5 } }))
    expect(r.windows.map(w => w.resetsAt)).toEqual([null, null])
  })

  it('额外用量：金额和百分比对得上才显示金额，对不上只留百分比', () => {
    const on = (extra: Record<string, unknown>) =>
      ok(usage({ extra_usage: { is_enabled: true, decimal_places: 2, ...extra } })).extras.extraUsage
    expect(on({ monthly_limit: 5000, used_credits: 1240, utilization: 24.8, currency: 'USD' })).toEqual({
      enabled: true,
      used: 12.4,
      limit: 50,
      currency: 'USD',
      usedPercent: 24.8,
    })
    // 单位其实不是分：金额和 utilization 差很多 → 金额置 null
    expect(on({ monthly_limit: 5000, used_credits: 1240, utilization: 60, currency: 'USD' })).toEqual({
      enabled: true,
      used: null,
      limit: null,
      currency: 'USD',
      usedPercent: 60,
    })
    // 没有 utilization 无法校验：不显示金额，百分比按金额之比
    expect(on({ monthly_limit: 5000, used_credits: 1250, utilization: null, currency: 'USD' })).toMatchObject({
      used: null,
      limit: null,
      usedPercent: 25,
    })
    expect(on({ monthly_limit: 5000, used_credits: 5000, utilization: 100, spend_limit_reached: true })).toMatchObject({
      reached: true,
      usedPercent: 100,
    })
    // decimal_places 不是数字：按 2 位
    expect(on({ monthly_limit: 1000, used_credits: 100, utilization: 10, decimal_places: 'x' })).toMatchObject({
      used: 1,
      limit: 10,
    })
  })

  it('没开额外用量就不出 extraUsage', () => {
    expect(ok(usage({ extra_usage: { is_enabled: false } })).extras.extraUsage).toBeUndefined()
  })

  it('spend 开着时优先用 spend', () => {
    const r = ok(
      usage({
        spend: {
          enabled: true,
          used: { amount_minor: 1240, currency: 'USD', exponent: 2 },
          limit: { amount_minor: 5000, currency: 'USD', exponent: 2 },
          percent: 24.8,
        },
        extra_usage: { is_enabled: true, monthly_limit: 1, used_credits: 1, utilization: 99 },
      }),
    )
    expect(r.extras.extraUsage).toEqual({ enabled: true, used: 12.4, limit: 50, currency: 'USD', usedPercent: 24.8 })
  })

  it('多出未知字段、字段类型全错也不抛', () => {
    const r = ok(usage({ brand_new_thing: { a: 1 }, five_hour: { utilization: 4, resets_at: 1, extra: true } }))
    expect(r.windows.find(w => w.id === 'five_hour')?.usedPercent).toBe(4)
    expect(() =>
      parseClaudeUsage(
        { subscription_type: 5, rate_limits_available: true, rate_limits: { limits: 'x', model_scoped: 3, spend: 7 } },
        NOW,
      ),
    ).not.toThrow()
  })
})

describe('parseClaudeRateLimitEvent', () => {
  const info = () => fixture('claude-rate-limit-event.json').rate_limit_info

  it('实测事件：0.03 → 3%、0.67 → 67%，秒 → 毫秒', () => {
    const patch = parseClaudeRateLimitEvent(info(), NOW)
    expect(patch).toEqual({
      observedAt: NOW,
      windows: [
        { id: 'five_hour', durationMins: 300, usedPercent: 3, resetsAt: 1_792_400_400_000 },
        { id: 'seven_day', durationMins: 10_080, usedPercent: 67, resetsAt: 1_792_566_000_000 },
      ],
      allowed: true,
      blocked: null,
      overage: false,
    })
  })

  it('不是对象 → null；什么有用的都没带 → null', () => {
    expect(parseClaudeRateLimitEvent(undefined, NOW)).toBeNull()
    expect(parseClaudeRateLimitEvent('x', NOW)).toBeNull()
    expect(parseClaudeRateLimitEvent([], NOW)).toBeNull()
    expect(parseClaudeRateLimitEvent({ foo: 1 }, NOW)).toBeNull()
  })

  it('rejected + seven_day → 本周 rejected 且按 100%', () => {
    const patch = parseClaudeRateLimitEvent(
      {
        status: 'rejected',
        rateLimitType: 'seven_day',
        resetsAt: 1_792_566_000,
        unifiedWindows: {
          five_hour: { utilization: 0.3, resetsAt: 1_792_400_400 },
          seven_day: { utilization: 0.97, resetsAt: 1_792_566_000 },
        },
      },
      NOW,
    )!
    expect(patch.windows).toEqual([
      expect.objectContaining({ id: 'five_hour', usedPercent: 30 }),
      { id: 'seven_day', durationMins: 10_080, usedPercent: 100, resetsAt: 1_792_566_000_000, rejected: true },
    ])
    expect(patch.allowed).toBeUndefined()
    expect(patch.blocked).toBeUndefined()
  })

  it('rejected + seven_day_opus → Opus rejected', () => {
    const patch = parseClaudeRateLimitEvent(
      { status: 'rejected', rateLimitType: 'seven_day_opus', resetsAt: 1_792_566_000 },
      NOW,
    )!
    expect(patch.windows).toBeUndefined()
    expect(patch.models).toEqual([
      { name: 'Opus', durationMins: 10_080, usedPercent: 100, resetsAt: 1_792_566_000_000, rejected: true },
    ])
  })

  it('rejected + 不认识的类型（overage）→ blocked', () => {
    expect(
      parseClaudeRateLimitEvent({ status: 'rejected', rateLimitType: 'overage', resetsAt: 1_792_566_000 }, NOW),
    ).toEqual({ observedAt: NOW, blocked: { kind: 'overage', resetsAt: 1_792_566_000_000 } })
    expect(parseClaudeRateLimitEvent({ status: 'rejected' }, NOW)?.blocked).toEqual({
      kind: 'rejected',
      resetsAt: null,
    })
  })

  it('allowed / allowed_warning → allowed 并清掉 blocked', () => {
    for (const status of ['allowed', 'allowed_warning'])
      expect(parseClaudeRateLimitEvent({ status }, NOW)).toMatchObject({ allowed: true, blocked: null })
  })

  it('没有 unifiedWindows 时退回顶层字段', () => {
    const patch = parseClaudeRateLimitEvent(
      { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.86, resetsAt: 1_792_400_400 },
      NOW,
    )!
    expect(patch.windows).toEqual([
      { id: 'five_hour', durationMins: 300, usedPercent: 86, resetsAt: 1_792_400_400_000 },
    ])
  })

  it('unifiedWindows 里的 Opus / Sonnet 进 models，其它键忽略', () => {
    const patch = parseClaudeRateLimitEvent(
      {
        unifiedWindows: {
          seven_day_opus: { utilization: 0.5, resetsAt: 1_792_566_000 },
          seven_day_sonnet: { utilization: 0.1, resetsAt: 1_792_566_000 },
          overage: { utilization: 0.9 },
          toString: { utilization: 1 },
        },
      },
      NOW,
    )!
    expect(patch.models?.map(m => [m.name, m.usedPercent])).toEqual([
      ['Opus', 50],
      ['Sonnet', 10],
    ])
    expect(patch.windows).toBeUndefined()
  })

  it('isUsingOverage 是布尔才填 overage', () => {
    expect(parseClaudeRateLimitEvent({ status: 'allowed', isUsingOverage: true }, NOW)?.overage).toBe(true)
    expect(parseClaudeRateLimitEvent({ status: 'allowed', isUsingOverage: 'yes' }, NOW)?.overage).toBeUndefined()
  })
})

describe('unknownControl', () => {
  it('认「不认识」，不认超时和进程退出', () => {
    expect(unknownControl(new Error('Unknown control request subtype: get_usage'))).toBe(true)
    expect(unknownControl(new Error('invalid request subtype'))).toBe(true)
    expect(unknownControl(new Error('Claude Code 没有回应 get_usage'))).toBe(false)
    expect(unknownControl(new Error('Claude Code 进程已退出'))).toBe(false)
    expect(unknownControl(new Error('usage endpoint failed'))).toBe(false)
  })
})
