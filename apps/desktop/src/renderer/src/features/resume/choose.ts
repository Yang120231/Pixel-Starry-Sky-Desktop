// 选中一行之后做什么（docs/ui/claude-resume.md §2.3）：已被占用的跳过去，其余导入成新对话。
// 不碰界面，依赖都从 deps 传进来，测试直接覆盖
import type { NativeImportResult, SessionSettings } from '@pixelsky/protocol'
import { tr, translateMessage } from '../../i18n/core'
import type { ResumeRow } from './model'

export type ChooseHow = 'default' | 'copy' | 'inplace'

export interface ChooseDeps {
  /** 导入成新对话（store.importNativeSession 的壳，projectId 已绑好） */
  importSession(
    nativeId: string,
    opts: { mode: 'inplace' | 'copy'; settings: Partial<SessionSettings>; token: string },
  ): Promise<NativeImportResult>
  /** 这一行的尾部还没补到时，单独要一次它最后用的模型 */
  modelOf(nativeId: string): Promise<string | null>
  /** 输入框的设置：模型、额度来源、权限、推理强度（按 model.ts 的规则挑模型） */
  settingsFor(sessionModel: string | null): Partial<SessionSettings>
  token: string
}

export type ChooseOutcome =
  | { kind: 'owned'; sessionId: string }
  | { kind: 'opened'; sessionId: string }
  /** 原地导入时发现正开着（列表之后才开的）：界面给两个按钮 */
  | { kind: 'live'; live: 'terminal' | 'other' }

export async function chooseRow(row: ResumeRow, how: ChooseHow, deps: ChooseDeps): Promise<ChooseOutcome> {
  if (row.ownerId) return { kind: 'owned', sessionId: row.ownerId }
  const mode =
    how === 'copy'
      ? 'copy'
      : how === 'inplace'
        ? 'inplace'
        : row.live === 'terminal' || row.live === 'other'
          ? 'copy'
          : 'inplace'
  const model = row.model ?? (await deps.modelOf(row.id).catch(() => null))
  const result = await deps.importSession(row.id, { mode, settings: deps.settingsFor(model), token: deps.token })
  if ('ownerId' in result) return { kind: 'owned', sessionId: result.ownerId }
  if ('live' in result) return { kind: 'live', live: result.live }
  return { kind: 'opened', sessionId: result.sessionId }
}

/** 错误是不是「这个会话的记录已经不在了」（宿主报的中文句子，按界面语言翻译后和词典里的比） */
export const isGoneError = (message: string): boolean => translateMessage(message) === tr('resume.gone')
