// 行首的状态（docs/ui/conversation-concise.md §7.1）：橙色圆点 = 进行中，绿勾 = 完成，红叉 = 失败，
// 空心圈 = 没开始 / 被拒绝 / 中断。工具调用、思考、待办、子智能体共用，固定 14px 宽，各行的图标对齐
import { Check, X } from 'lucide-react'
import { cn } from '@/ui'

export type DotStatus = 'running' | 'completed' | 'failed' | 'pending' | 'declined' | 'interrupted' | 'none'

export function StatusDot({ status, className }: { status: DotStatus; className?: string }) {
  return (
    <span data-status-dot={status} className={cn('flex w-[14px] shrink-0 items-center justify-center', className)}>
      {status === 'running' && <span className="size-[7px] animate-pulse rounded-full bg-active" />}
      {status === 'completed' && <Check size={13} strokeWidth={2.25} className="text-success" />}
      {status === 'failed' && <X size={13} strokeWidth={2.25} className="text-danger" />}
      {(status === 'pending' || status === 'declined' || status === 'interrupted') && (
        <span className="size-[7px] rounded-full border-[1.5px] border-fg-faint" />
      )}
    </span>
  )
}
