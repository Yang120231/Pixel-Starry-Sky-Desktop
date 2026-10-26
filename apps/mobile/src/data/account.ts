// 电脑账号的余额文字（照电脑端 renderer/src/features/account/format.ts 的 formatBalance）

const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** USD 显示 "$12.34"，其他币种 "12.34 CNY"；大于 0 不足 0.01 显示 "<$0.01"；拿不到显示 "—" */
export function formatBalance(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const code = currency.toUpperCase()
  const usd = code === 'USD'
  const wrap = (text: string) => (usd ? `$${text}` : `${text} ${code}`)
  if (value > 0 && value < 0.01) return usd ? '<$0.01' : `<0.01 ${code}`
  const abs = money.format(Math.abs(value))
  // 四舍五入后为 0 的负数不显示负号
  return value < 0 && abs !== '0.00' ? `-${wrap(abs)}` : wrap(abs)
}
