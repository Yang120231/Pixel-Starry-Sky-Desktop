// AI 写提交信息（docs/ui/ai-commit-codex-warnings-history.md §2）：提交信息输入框右上角的按钮、生成后的那一行
// （AI 写的 · 费用 · 撤销）和出错时的说法。只在点按钮时发请求；写好直接填进输入框，不自动提交
import { useEffect, useRef, useState } from 'react'
import { Sparkles, Square } from 'lucide-react'
import type { AiCommitRequest, AiProblem } from '../../../../../shared/types/ai'
import type { GitCommitScope } from '../../../../../shared/types/project-tools'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'
import { cn, Spinner } from '@/ui'
import { getLocale, tr, translateMessage } from '@/i18n/core'
import { useAccount } from '@/features/account'
import { getPlatformState, refreshPlatform, usePlatform } from '@/features/account/platform'
import { useProviders } from '@/features/account/providers'
import { useSettings } from '@/features/settings/SettingsProvider'
import { commitGroups, commitProvider, estimateUsd, useAiCommitSettings } from '@/features/settings/aiCommit'
import { formatCost } from '@/features/usage/format'

type Note =
  | {
      kind: 'done'
      /** 填进去之前输入框里的字（撤销用） */
      previous: string
      written: string
      cost: number | null
      charged: boolean
      partial: number
    }
  | { kind: 'error'; problem: AiProblem; detail: string; model: string }

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function useAiCommit({
  target,
  demo,
  message,
  setMessage,
}: {
  target: WorkspaceRef
  demo: boolean
  message: string
  setMessage: (message: string) => void
}) {
  const { writing, model } = useAiCommitSettings()
  const providers = useProviders()
  usePlatform('claude')
  const [running, setRunning] = useState<string | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const live = useRef(true)
  const current = useRef(message)
  current.current = message
  useEffect(
    () => () => {
      live.current = false
    },
    [],
  )
  // 改了 AI 写的字：「撤销」和费用那一行就不再显示
  useEffect(() => {
    if (note?.kind === 'done' && message !== note.written) setNote(null)
  }, [message, note])

  const fail = (problem: AiProblem, detail = '', name = model.model) =>
    setNote({ kind: 'error', problem, detail, model: name })

  const start = async (scope: GitCommitScope): Promise<void> => {
    if (running) return
    const requestId = crypto.randomUUID()
    setNote(null)
    setRunning(requestId)
    try {
      if (demo) {
        await wait(600)
        if (!live.current) return
        const written = tr('aiCommit.demoMessage')
        setNote({ kind: 'done', previous: current.current, written, cost: null, charged: false, partial: 0 })
        setMessage(written)
        return
      }
      const api = window.pixelsky?.ai
      if (!api) return
      const base = {
        requestId,
        ref: target,
        scope,
        language: writing.language,
        uiLanguage: getLocale() === 'en-US' ? 'en' : 'zh',
        style: writing.style,
        instructions: writing.instructions,
      } satisfies Partial<AiCommitRequest>
      let request: AiCommitRequest
      let multiplier = 1
      let priceRef: string | null = null
      if (model.source === 'platform') {
        let platform = getPlatformState('claude')
        if (!platform.email) return fail('signedOut')
        if (!platform.loaded) {
          await refreshPlatform()
          platform = getPlatformState('claude')
        }
        const groups = commitGroups(platform.groups, model.model, model.groupId, platform.groupId)
        if (!groups.length) return fail('model')
        multiplier = platform.groups.find(g => g.id === groups[0])?.rate_multiplier ?? 1
        request = { ...base, source: 'platform', groups, providerId: null, model: model.model }
      } else {
        const chosen = commitProvider(providers.providers, model)
        if (!chosen) return fail('provider', 'missing')
        if (!chosen.provider.keyHint) return fail('provider', 'noKey')
        priceRef = chosen.provider.models.find(m => m.id === chosen.model)?.priceRef ?? null
        request = { ...base, source: 'custom', groups: [], providerId: chosen.provider.id, model: chosen.model }
      }
      const result = await api.commitMessage(request)
      if (!live.current) return
      if (!result.ok) {
        if (result.problem !== 'cancelled') fail(result.problem, result.detail, request.model)
        return
      }
      if (result.groupId)
        multiplier = getPlatformState('claude').groups.find(g => g.id === result.groupId)?.rate_multiplier ?? multiplier
      const written = result.message
      setNote({
        kind: 'done',
        previous: current.current,
        written,
        cost: estimateUsd(result.usage, result.model, multiplier, priceRef),
        charged: false,
        partial: result.partial,
      })
      setMessage(written)
      if (result.chargeable)
        void api
          .commitCharge(requestId)
          .then(usd => {
            if (usd === null || !live.current) return
            setNote(n => (n?.kind === 'done' && n.written === written ? { ...n, cost: usd, charged: true } : n))
          })
          .catch(() => undefined)
    } catch (e) {
      if (live.current) fail('failed', (e as Error)?.message ?? '')
    } finally {
      if (live.current) setRunning(id => (id === requestId ? null : id))
    }
  }

  return {
    enabled: writing.enabled,
    running: running !== null,
    note,
    start: (scope: GitCommitScope) => void start(scope),
    stop: () => {
      if (running && !demo) void window.pixelsky?.ai.cancel(running)
    },
    undo: () => {
      if (note?.kind === 'done') setMessage(note.previous)
      setNote(null)
    },
    dismiss: () => setNote(null),
  }
}

export type AiCommit = ReturnType<typeof useAiCommit>

/** 输入框右上角的按钮：平时是星光，生成中是转圈（悬停变成停止） */
export function AiCommitButton({ ai, disabled, scope }: { ai: AiCommit; disabled: boolean; scope: GitCommitScope }) {
  const label = tr(ai.running ? 'aiCommit.stopHint' : 'aiCommit.button')
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={!ai.running && disabled}
      onClick={() => (ai.running ? ai.stop() : ai.start(scope))}
      className={cn(
        'group/ai press absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-accent-fg disabled:pointer-events-none disabled:opacity-40',
        ai.running && 'text-accent-fg',
      )}
    >
      {ai.running ? (
        <>
          <Spinner size={13} className="group-hover/ai:hidden" />
          <Square size={11} strokeWidth={2} className="hidden fill-current group-hover/ai:block" />
        </>
      ) : (
        <Sparkles size={14} strokeWidth={1.5} />
      )}
    </button>
  )
}

const PROBLEM_TEXT: Record<Exclude<AiProblem, 'cancelled' | 'model' | 'provider'>, Parameters<typeof tr>[0]> = {
  signedOut: 'aiCommit.problem.signedOut',
  balance: 'aiCommit.problem.balance',
  route: 'aiCommit.problem.route',
  rateLimit: 'aiCommit.problem.rateLimit',
  network: 'aiCommit.problem.network',
  timeout: 'aiCommit.problem.timeout',
  empty: 'aiCommit.problem.empty',
  nothing: 'aiCommit.problem.nothing',
  failed: 'aiCommit.problem.failed',
}

function problemText(n: Extract<Note, { kind: 'error' }>): string {
  if (n.problem === 'provider')
    return n.detail === 'missing'
      ? tr('aiCommit.problem.noEndpoint')
      : n.detail === 'noKey'
        ? tr('aiCommit.problem.noKey')
        : translateMessage(n.detail)
  // 自定义接口说没有这个模型时，原话更准确
  if (n.problem === 'model')
    return n.detail ? translateMessage(n.detail) : tr('aiCommit.problem.noModel', { model: n.model })
  if (n.problem === 'cancelled') return ''
  const text = tr(PROBLEM_TEXT[n.problem])
  return n.detail && (n.problem === 'failed' || n.problem === 'network')
    ? tr('aiCommit.problemDetail', { text, detail: translateMessage(n.detail) })
    : text
}

/** 输入框下面那一行：写好了（AI 写的 · 费用 · 撤销），或者出错的说法和按钮 */
export function AiCommitNote({ ai }: { ai: AiCommit }) {
  const account = useAccount()
  const settings = useSettings()
  const note = ai.note
  if (ai.running) return <p className="mt-1 truncate px-0.5 text-meta text-fg-muted">{tr('aiCommit.writing')}</p>
  if (!note) return null
  if (note.kind === 'done')
    return (
      <p className="mt-1 flex min-w-0 items-center gap-1 px-0.5 text-meta text-fg-muted">
        <Sparkles size={12} strokeWidth={1.5} className="shrink-0 text-accent-fg" />
        <span className="min-w-0 truncate">
          {tr('aiCommit.writtenBy')}
          {note.cost !== null &&
            ' · ' +
              tr(note.charged ? 'aiCommit.charged' : 'aiCommit.cost', {
                cost: formatCost(note.cost, note.charged ? 'platform' : 'estimate'),
              })}
          {note.partial > 0 && ' · ' + tr('aiCommit.partialFiles', { n: note.partial })}
        </span>
        <button
          type="button"
          title={tr('aiCommit.undoHint')}
          onClick={ai.undo}
          className="ml-auto shrink-0 rounded px-1 text-accent-fg hover:bg-hover"
        >
          {tr('aiCommit.undo')}
        </button>
      </p>
    )
  const action = (label: Parameters<typeof tr>[0], run: () => void) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        ai.dismiss()
        run()
      }}
      className="shrink-0 rounded px-1 text-accent-fg hover:bg-hover"
    >
      {tr(label)}
    </button>
  )
  const models = () => settings.openSettings('models')
  return (
    <p role="alert" className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 px-0.5 text-meta text-danger">
      <span className="min-w-0 break-words">{problemText(note)}</span>
      {note.problem === 'signedOut' && action('aiCommit.signIn', () => void account.login())}
      {note.problem === 'balance' && action('aiCommit.openSettings', () => settings.openSettings('account'))}
      {(note.problem === 'signedOut' ||
        note.problem === 'route' ||
        note.problem === 'model' ||
        note.problem === 'provider') &&
        action('aiCommit.openSettings', models)}
    </p>
  )
}
