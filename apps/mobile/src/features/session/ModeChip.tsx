// 输入框上方的模式胶囊（只读，C1）：「每步问我 · Sonnet 4.5 · 中」。点了什么都不弹，C2 再接模式面板。
import type { SessionSettings } from '@pixelsky/protocol'
import { modeChip } from '@/data/mode'

export function ModeChip({ record }: { record: Pick<SessionSettings, 'permissionMode' | 'model' | 'effort'> }) {
  const chip = modeChip(record)
  const text = [chip.permission, chip.model, chip.effort].filter(Boolean).join(' · ')
  return (
    <div className="flex px-4 pb-1">
      <span className="max-w-full truncate rounded-full border border-line-subtle bg-surface px-2.5 py-0.5 text-label text-fg-muted">
        {text}
      </span>
    </div>
  )
}
