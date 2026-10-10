import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot } from 'lucide-react'
import { SessionHeader } from './SessionHeader'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { ComposerArea } from './ComposerArea'
import { WelcomeView } from './WelcomeView'
import { hasConversation } from './conversation'
import { LiveTranscript } from './live/LiveTranscript'
import { ApprovalCard } from './live/ApprovalCard'
import { AgentTracePanel } from './live/AgentTracePanel'
import { TaskStrip } from './live/SessionStrips'
import { ProgressCard, useProgress } from './live/ProgressCard'
import { TraceContext, type TraceTarget } from './live/trace'
import { PathLinksProvider } from '@/features/files/PathLinksProvider'
import { ConversationFind, useFindShortcut } from '@/features/search/ConversationFind'
import { RetryStatus } from './live/RetryStatus'
import { MessageActionsContext, type MessageActionsValue } from './live/MessageActions'
import { appendComposerDraft } from '@/features/engine/drafts'
import { updateImages } from '@/features/session/attachments/drafts'
import { sessionDiff } from '@/data'
import { cn } from '@/ui'
import { bridge, isLive, useComposerController, useSession, useStatusBar } from '@/features/engine'
import './conversation.css'

export interface SessionViewProps {
  /** 当前会话，null 表示新会话（显示欢迎页） */
  sessionId: string | null
  title: string
  sidebarOpen: boolean
  panelOpen: boolean
  onToggleSidebar: () => void
  onTogglePanel: () => void
  /** 欢迎页发出第一条消息、创建了会话后切过去 */
  onOpenSession?: (id: string) => void
  /** 放在多窗格里：不画顶部栏（顶部栏由窗格区统一画，跟随当前窗格），也不设最小宽度（docs/ui/multi-pane.md） */
  embedded?: boolean
  /** 未发送的新会话与演示会话也按标签独立保留草稿。 */
  draftKey?: string
}

/** 顶部栏要不要显示会话操作（更多、编辑器、提交、终端、改动统计）：多窗格时顶部栏在窗格外面，用这个保持和单窗格一致 */
export function useHeaderActions(sessionId: string | null): boolean {
  const snapshot = useSession(isLive ? sessionId : null)
  if (!isLive) return sessionId !== null && (hasConversation || sessionDiff !== null)
  return !!snapshot && snapshot.items.length > 0
}

/** 会话主区：顶部栏 + 可滚动对话流 + 固定在底部的输入框；没有对话时显示欢迎页 */
export function SessionView(props: SessionViewProps) {
  useI18n()
  return isLive ? <LiveSessionView {...props} /> : <DemoSessionView {...props} />
}

/** 演示模式：照参考图的静态内容（mock/demo.ts） */
function DemoSessionView({
  sessionId,
  title,
  sidebarOpen,
  panelOpen,
  onToggleSidebar,
  onTogglePanel,
  embedded,
  draftKey,
}: SessionViewProps) {
  useI18n()
  const showConversation = sessionId !== null && hasConversation
  return (
    <main
      className={cn('conversation-view flex flex-1 flex-col bg-app', embedded ? 'min-h-0 min-w-0' : 'min-w-[464px]')}
    >
      {!embedded && (
        <SessionHeader
          title={title}
          showActions={showConversation || (sessionId !== null && sessionDiff !== null)}
          sidebarOpen={sidebarOpen}
          panelOpen={panelOpen}
          onToggleSidebar={onToggleSidebar}
          onTogglePanel={onTogglePanel}
        />
      )}
      {showConversation ? (
        <>
          <Transcript sessionId={sessionId} />
          <ComposerArea>
            <Composer draftKey={draftKey} />
          </ComposerArea>
        </>
      ) : (
        <WelcomeView draftKey={draftKey} />
      )}
    </main>
  )
}

/** 真实会话：数据来自引擎（docs/engines.md §11、§15） */
function LiveSessionView({
  sessionId,
  title,
  sidebarOpen,
  panelOpen,
  onToggleSidebar,
  onTogglePanel,
  onOpenSession,
  embedded,
  draftKey,
}: SessionViewProps) {
  useI18n()
  const snapshot = useSession(sessionId)
  const composer = useComposerController(sessionId, onOpenSession, draftKey)
  const status = useStatusBar(sessionId, draftKey)
  // 智能体追踪面板：null 表示关着；focus 是定位到的智能体（null 是总览）
  const [trace, setTrace] = useState<{ focus: string | null } | null>(null)
  useEffect(() => setTrace(null), [sessionId])
  // 对话内搜索（Ctrl+F）：token 每按一次加一，已经打开时重新聚焦（docs/ui/content-highlight.md §2 E）
  const mainRef = useRef<HTMLElement>(null)
  const [find, setFind] = useState<number | null>(null)
  useEffect(() => setFind(null), [sessionId])
  useFindShortcut(mainRef, !!sessionId, () => setFind(n => (n ?? 0) + 1))

  const runs = snapshot?.runs
  const openTrace = useCallback(
    (target?: TraceTarget) => {
      let focus = target?.agentId ?? null
      if (!focus && target?.toolUseId && runs) {
        // Agent 工具调用 → 它派出的子智能体；Workflow 工具调用 → 总览
        focus = runs.agents.find(a => a.toolUseId === target.toolUseId)?.id ?? null
      }
      setTrace({ focus })
    },
    [runs],
  )
  const hasRuns = !!runs && (runs.workflows.length > 0 || runs.agents.length > 0)
  const tasks = snapshot?.tasks ?? []
  // 计划和子智能体在右上角的进度卡片里；卡片显示时「智能体活动」也放进卡片（docs/ui/progress-card.md）
  const progress = useProgress(snapshot)
  const traceInStrips = hasRuns && !progress.visible
  const showStrips = !!sessionId && (tasks.length > 0 || traceInStrips)

  // 回退：主进程截断对话后，把原文和图片放回这个窗格的输入框（与撤回排队消息一致，追加到已有草稿后）
  const busy =
    !!snapshot &&
    (snapshot.state !== 'idle' || snapshot.queue.some(q => ['dispatching', 'running', 'delivering'].includes(q.status)))
  const rewindSupported = composer?.engine?.caps.rewind === true
  const composerKey = draftKey ?? sessionId ?? ''
  const messageActions = useMemo<MessageActionsValue | null>(
    () =>
      !sessionId || !bridge
        ? null
        : {
            rewindDisabledReason: !rewindSupported
              ? tr('session.message.rewindUnsupported')
              : busy
                ? tr('session.message.rewindBusy')
                : null,
            rewind: async item => {
              const result = await bridge!.rewind(sessionId, item.id)
              appendComposerDraft(composerKey, result.text)
              const images = result.attachments ?? []
              if (images.length)
                await updateImages(composerKey, current => [
                  ...current,
                  ...images.filter(image => !current.some(c => c.id === image.id)),
                ]).catch(() => undefined)
            },
          },
    [sessionId, rewindSupported, busy, composerKey],
  )

  return (
    <PathLinksProvider sessionId={sessionId}>
      <TraceContext.Provider value={sessionId ? openTrace : null}>
        <main
          ref={mainRef}
          className={cn(
            'conversation-view relative flex flex-1 flex-col bg-app',
            embedded ? 'min-h-0 min-w-0' : 'min-w-[464px]',
          )}
        >
          {!embedded && (
            <SessionHeader
              title={title}
              showActions={!!snapshot && snapshot.items.length > 0}
              sidebarOpen={sidebarOpen}
              panelOpen={panelOpen}
              onToggleSidebar={onToggleSidebar}
              onTogglePanel={onTogglePanel}
            />
          )}
          {sessionId ? (
            <>
              <div className="relative flex min-h-0 flex-1 flex-col">
                {showStrips && (
                  <div className="conversation-inset conversation-reading conversation-reading-strips shrink-0 pt-3">
                    <div className="conversation-message flex flex-col gap-2">
                      {traceInStrips && (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => openTrace()}
                            className="press inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-meta text-fg-muted hover:bg-hover hover:text-fg"
                          >
                            <Bot size={13} strokeWidth={1.75} />
                            {tr('session.live.AgentTracePanel.agentActivity')}{' '}
                          </button>
                        </div>
                      )}
                      <TaskStrip sessionId={sessionId} tasks={tasks} />
                    </div>
                  </div>
                )}
                <MessageActionsContext.Provider value={messageActions}>
                  <LiveTranscript snapshot={snapshot} />
                </MessageActionsContext.Provider>
                {progress.visible && !trace && (
                  <ProgressCard
                    key={sessionId}
                    progress={progress}
                    belowFind={find !== null}
                    onOpenTrace={hasRuns ? () => openTrace() : undefined}
                  />
                )}
                {find !== null && <ConversationFind root={mainRef} focusToken={find} onClose={() => setFind(null)} />}
              </div>
              <ComposerArea>
                <RetryStatus sessionId={sessionId} retry={snapshot?.retry} />
                {snapshot?.pending.map(req => (
                  <ApprovalCard
                    key={req.requestId}
                    request={req}
                    onAnswer={d => void bridge?.answer(sessionId, req.requestId, d)}
                  />
                ))}
                <Composer key={sessionId} live={composer} status={status} draftKey={draftKey} autoFocus />
              </ComposerArea>
              {trace && runs && (
                <AgentTracePanel
                  sessionId={sessionId}
                  runs={runs}
                  focus={trace.focus}
                  onFocus={focus => setTrace({ focus })}
                  onClose={() => setTrace(null)}
                />
              )}
            </>
          ) : (
            <WelcomeView live={composer} status={status} draftKey={draftKey} />
          )}
        </main>
      </TraceContext.Provider>
    </PathLinksProvider>
  )
}
