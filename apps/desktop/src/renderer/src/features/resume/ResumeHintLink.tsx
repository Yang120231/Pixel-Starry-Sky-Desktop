import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { cn } from '@/ui'
import { hintEngine, hintText, openResumeFor, useResumeCounts } from './hint'

/**
 * 「终端里有 N 个 Claude Code / Codex 会话 · 接着聊」：点「接着聊」打开这个项目的 /resume 选择器（两个引擎都有先打开 Claude Code 的）。
 * 没有会话 / 还没查到 / 查询失败 / 远程项目时什么都不画。
 * fetch 为 false 时不自己触发查询，只显示别处（导入后的批量预查）已经查到的
 */
export function ResumeHintLink({
  projectId,
  separator = 'dot',
  fetch = true,
  className,
}: {
  projectId: string | null | undefined
  separator?: 'dot' | 'comma'
  fetch?: boolean
  className?: string
}) {
  useI18n()
  const counts = useResumeCounts(projectId, fetch)
  const text = counts ? hintText(counts) : null
  if (!projectId || !counts || !text) return null
  const engine = hintEngine(counts)
  return (
    <span data-resume-hint className={cn('text-label text-fg-muted', className)}>
      {text}
      {tr(separator === 'dot' ? 'resume.hint.sep.dot' : 'resume.hint.sep.comma')}
      <button
        type="button"
        data-resume-hint-action
        onClick={() => openResumeFor(projectId, engine)}
        className="text-accent-fg hover:underline"
      >
        {tr('resume.hint.action')}
      </button>
    </span>
  )
}
