import { Construction } from 'lucide-react'

/** 契约桩的占位：各模块还没实现时显示这个 */
export function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center gap-2 text-xs text-fg-muted">
      <Construction size={16} strokeWidth={1.5} className="shrink-0" />
      <span>{label}</span>
    </div>
  )
}
