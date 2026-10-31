// 首页 = 会话列表（C3，docs/mobile-remote.md §21.3、§26）：大标题页，左上圆形菜单键、右上圆形新建键；「等你处理」置顶，其余置顶的在前、再按时间排。
// 分组是 fg-muted 小标题 + 平铺的行，行和抽屉里的一样（ui/SessionRow：标题 + 时间，状态点 + 引擎 · 项目 · 状态或最后一句回复，细线分隔）。
// 搜索（标题在手机上筛，对话内容问电脑）、按项目筛、显示更多（§17 第 6 项）；左上角的菜单按钮由 App 传进来。
import { useState, type ReactNode } from 'react'
import { CloudOff, Inbox, Laptop, MonitorSmartphone, Plus, SearchX, ShieldOff, SquarePen, WifiOff } from 'lucide-react'
import type { SessionSummary } from '@pixelsky/protocol'
import type { Pairing } from '@/connection'
import { useContentSearch, useDesktop } from '@/data/hooks'
import {
  RECENT_STEP,
  ago,
  filterTasks,
  projectNameOf,
  sessionList,
  sessionStatus,
  taskProjects,
  taskTitle,
} from '@/data/tasks'
import { L } from '@/i18n'
import { linkStateLabel } from '@/i18n/labels'
import { Button, Dot, Empty, IconButton, Screen, Spinner } from '@/ui'
import { Chips, ContentResults, SearchField } from '@/ui/search'
import { SessionRow } from '@/ui/SessionRow'
import { ConnectionBanner, ReconnectButton, replacedBody, replacedTitle } from './Reconnect'

export function TaskList({
  pairing,
  menu,
  onOpen,
  onNew,
}: {
  pairing: Pairing
  menu: ReactNode
  onOpen(sessionId: string): void
  onNew(): void
}) {
  const { state, sessions, projects, loaded, cached } = useDesktop(pairing.deviceId)
  const [query, setQuery] = useState('')
  const [project, setProject] = useState('')
  const [recentLimit, setRecentLimit] = useState(RECENT_STEP)
  const projectName = (s: SessionSummary) => projectNameOf(projects, s.record.projectId)
  const withTasks = taskProjects(sessions, projects)
  // 筛的项目没有任务了（被删、归档）就回到全部
  const projectId = withTasks.some(p => p.id === project) ? project : null
  const filtered = filterTasks(sessions, query, projectId, projectName)
  const list = sessionList(filtered, recentLimit)
  // 只有一个项目、或已经按项目筛了：行里不再写项目名
  const showProject = withTasks.length > 1 && !projectId
  const searching = !!query.trim()
  const content = useContentSearch(pairing.deviceId, query, projectId)
  const ready = state === 'ready'
  const canAct = ready && pairing.status === 'paired'

  return (
    <Screen
      large
      title={L('会话', 'Conversations')}
      leading={menu}
      subtitle={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-1 text-meta text-fg-secondary">
          <Laptop size={14} />
          <span className="max-w-48 truncate">{pairing.desktopName}</span>
          <Dot
            tone={ready ? 'online' : state === 'removed' || state === 'incompatible' ? 'danger' : 'muted'}
            pulse={state === 'connecting' || state === 'handshaking'}
          />
          <span className="text-fg-muted">{state ? linkStateLabel(state) : ''}</span>
        </span>
      }
      actions={
        <IconButton
          round
          label={L('新建会话', 'New conversation')}
          icon={SquarePen}
          disabled={!canAct}
          onClick={onNew}
        />
      }
    >
      {state === 'replaced' && !loaded ? (
        <Empty
          icon={MonitorSmartphone}
          title={replacedTitle()}
          body={replacedBody()}
          action={
            <div className="mt-2">
              <ReconnectButton deviceId={pairing.deviceId} />
            </div>
          }
        />
      ) : state === 'removed' ? (
        <Empty
          icon={ShieldOff}
          title={L('已被电脑移除', 'Removed by the computer')}
          body={L(
            '到「设置」里删掉这台电脑，再在电脑上重新扫码配对。',
            'Remove this computer in Settings, then scan the QR code on the computer again to pair.',
          )}
        />
      ) : state === 'incompatible' && !loaded ? (
        <Empty
          icon={ShieldOff}
          title={L('版本不一致', 'Version mismatch')}
          body={L(
            '电脑版和手机版的连接协议不一样，把两边都更新到最新版再试。',
            'The computer and phone use different connection protocols. Update both to the latest version and try again.',
          )}
        />
      ) : state === 'unrecognized' && !loaded ? (
        <Empty
          icon={ShieldOff}
          title={L('电脑上找不到配对', 'Pairing not found on the computer')}
          body={L(
            '电脑可能已移除这部手机，或重装过。会自动再试；也可以到「设置」里删掉这台电脑后重新扫码。',
            'The computer may have removed this phone or been reinstalled. Retrying automatically. You can also remove this computer in Settings and scan the QR code again.',
          )}
        />
      ) : state === 'desktop_offline' && !loaded ? (
        <Empty
          icon={CloudOff}
          title={L('电脑不在线', 'Computer offline')}
          body={L(
            '打开电脑上的像素星空，并在 设置 › 手机 里保持「允许手机远程连接」打开。',
            'Open PixelSky on the computer and keep “Allow remote phone connections” on in Settings › Phone.',
          )}
        />
      ) : state === 'offline' && !loaded ? (
        <Empty
          icon={WifiOff}
          title={L('连不上网络', 'No network')}
          body={L(
            '检查一下手机网络，恢复后会自动重连。',
            "Check your phone's network. It will reconnect automatically once it's back.",
          )}
        />
      ) : !loaded ? (
        <div className="flex items-center justify-center gap-2 py-16 text-meta text-fg-muted">
          <Spinner /> {L('正在连接电脑…', 'Connecting to the computer…')}
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-6">
          <ConnectionBanner
            deviceId={pairing.deviceId}
            kept={L(
              `下面是${cached ? '上次打开时' : '断开前'}的内容，恢复后会自动更新。`,
              `Showing content from ${cached ? 'the last visit' : 'before the disconnect'}. It will update once reconnected.`,
            )}
          />
          {sessions.length === 0 ? (
            <Empty
              icon={Inbox}
              title={L('还没有会话', 'No conversations yet')}
              body={L(
                '在手机上给电脑派个活儿，结果和改动都能在这里看。',
                'Give your computer a task from your phone. Results and changes show up here.',
              )}
              action={
                <Button variant="primary" disabled={!canAct} onClick={onNew} className="mt-2 min-h-11! rounded-full!">
                  <Plus size={18} /> {L('新建会话', 'New conversation')}
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex flex-col gap-2.5">
                <SearchField
                  value={query}
                  onChange={setQuery}
                  placeholder={L('搜索会话标题、项目、对话内容', 'Search titles, projects, and messages')}
                />
                {withTasks.length > 1 && (
                  <Chips
                    value={projectId ?? ''}
                    onChange={setProject}
                    items={[
                      { value: '', label: L('全部项目', 'All projects') },
                      ...withTasks.map(p => ({ value: p.id, label: p.name })),
                    ]}
                  />
                )}
              </div>
              <Group
                title={L('等你处理', 'Needs you')}
                tone="warn"
                list={list.waiting}
                project={showProject ? projectName : undefined}
                onOpen={onOpen}
              />
              <Group
                title={
                  searching
                    ? L('标题匹配', 'Title matches')
                    : list.waiting.length
                      ? L('其他会话', 'Other conversations')
                      : undefined
                }
                list={list.rest}
                project={showProject ? projectName : undefined}
                onOpen={onOpen}
                more={
                  list.more > 0 && (
                    <button
                      type="button"
                      onClick={() => setRecentLimit(n => n + RECENT_STEP)}
                      className="flex min-h-11 w-full items-center px-5 text-left text-meta text-accent-fg active:bg-hover"
                    >
                      {L(`显示更多（还有 ${list.more} 个）`, `Show more (${list.more} more)`)}
                    </button>
                  )
                }
              />
              {searching && !content.unsupported && (
                <ContentResults
                  results={content.results}
                  loading={content.loading}
                  truncated={content.truncated}
                  when={ago}
                  onOpen={onOpen}
                />
              )}
              {searching && !filtered.length && !content.loading && !content.results.length && (
                <Empty
                  icon={SearchX}
                  title={L('没有找到', 'No results')}
                  body={
                    content.unsupported
                      ? L(
                          '电脑上的像素星空版本较旧，只能搜标题和项目名。',
                          'The PixelSky app on your computer is out of date, so only titles and project names can be searched.',
                        )
                      : L('换个关键词试试。', 'Try a different keyword.')
                  }
                />
              )}
            </>
          )}
        </div>
      )}
    </Screen>
  )
}

function Group({
  title,
  tone,
  list,
  project,
  onOpen,
  more,
}: {
  title?: string
  tone?: 'warn'
  list: SessionSummary[]
  project?(s: SessionSummary): string
  onOpen(id: string): void
  more?: ReactNode
}) {
  if (!list.length) return null
  return (
    <section>
      {title && (
        <h2 className="flex items-center gap-1.5 px-5 pb-1 text-meta font-medium text-fg-muted">
          {tone && <Dot tone={tone} />}
          {title}
          <span className="text-fg-faint">{list.length}</span>
        </h2>
      )}
      {list.map(s => (
        <SessionRow
          key={s.record.id}
          engine={s.record.engine}
          title={taskTitle(s)}
          time={ago(s.record.updatedAt)}
          project={project?.(s)}
          preview={s.record.lastReply}
          status={sessionStatus(s)}
          pinned={!!s.record.pinnedAt && s.state !== 'waiting'}
          onClick={() => onOpen(s.record.id)}
        />
      ))}
      {more}
    </section>
  )
}
