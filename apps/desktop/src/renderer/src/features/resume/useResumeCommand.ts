import { useMemo } from 'react'
import type { EngineId } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { machineOf } from '@/features/machines/store'

/** 「/」菜单里像素星空自己的命令（不是引擎给的）；现在只有 /resume */
export interface AppCommand {
  invocation: 'app'
  name: string
  description: string
  source: 'app'
}

/** 只有执行者是 Claude Code、对话不在远程机器上才出现（执行者看 nextEngine ?? engine，新任务看草稿 / 默认） */
export function resumeAvailable(engine: EngineId | null | undefined, workspaceId: string | null | undefined): boolean {
  return engine === 'claude' && machineOf(workspaceId) === 'local'
}

export function useResumeCommand(
  engine: EngineId | null | undefined,
  workspaceId: string | null | undefined,
): AppCommand | null {
  const { locale } = useI18n()
  const available = resumeAvailable(engine, workspaceId)
  return useMemo(
    () =>
      available
        ? { invocation: 'app', name: 'resume', description: tr('resume.command.description'), source: 'app' }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, locale],
  )
}
