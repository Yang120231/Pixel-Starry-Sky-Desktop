// 首页：当前电脑的任务，分「等你处理 / 运行中 / 最近」（docs/mobile-remote.md §8.3）
import type { ReactNode } from 'react'
import { CloudOff, Inbox, Laptop, Plus, ShieldOff, WifiOff } from 'lucide-react'
import { ENGINES, type SessionSummary } from '@pixelsky/protocol'
import type { Pairing } from '@/connection'
import { useDesktop } from '@/data/hooks'
import { ago, groupTasks, taskTitle } from '@/data/tasks'
import { linkStateText } from '@/i18n/zh'
import { Badge, Banner, Button, Dot, Empty, IconButton, Screen, Section, Spinner, cn } from '@/ui'

export function TaskList({
  pairing,
  tabBar,
  onOpen,
  onNew,
}: {
  pairing: Pairing
  tabBar: ReactNode
  onOpen(sessionId: string): void
  onNew(): void
}) {
  const { state, sessions, projects, loaded } = useDesktop(pairing.deviceId)
  const groups = groupTasks(sessions)
  const projectName = (s: SessionSummary) => projects.find(p => p.id === s.record.projectId)?.name ?? ''
  const ready = state === 'ready'
  const canAct = ready && pairing.status === 'paired'

  return (
    <Screen
      large
      title="任务"
      subtitle={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-1 text-meta text-fg-secondary">
          <Laptop size={14} />
          <span className="max-w-48 truncate">{pairing.desktopName}</span>
          <Dot
            tone={ready ? 'online' : state === 'removed' || state === 'incompatible' ? 'danger' : 'muted'}
            pulse={state === 'connecting' || state === 'handshaking'}
          />
          <span className="text-fg-muted">{state ? linkStateText[state] : ''}</span>
        </span>
      }
      actions={
        <IconButton label="新建任务" icon={Plus} disabled={!canAct} onClick={onNew} className="disabled:opacity-40" />
      }
      footer={tabBar}
    >
      {state === 'removed' ? (
        <Empty icon={ShieldOff} title="已被电脑移除" body="到「我的」里删掉这台电脑，再在电脑上重新扫码配对。" />
      ) : state === 'incompatible' && !loaded ? (
        <Empty icon={ShieldOff} title="版本不一致" body="电脑版和手机版的连接协议不一样，把两边都更新到最新版再试。" />
      ) : state === 'unrecognized' && !loaded ? (
        <Empty
          icon={ShieldOff}
          title="电脑上找不到配对"
          body="电脑可能已移除这部手机，或重装过。会自动再试；也可以到「我的」里删掉这台电脑后重新扫码。"
        />
      ) : state === 'desktop_offline' && !loaded ? (
        <Empty
          icon={CloudOff}
          title="电脑不在线"
          body="打开电脑上的像素星空，并在 设置 › 手机 里保持「允许手机远程连接」打开。"
        />
      ) : state === 'offline' && !loaded ? (
        <Empty icon={WifiOff} title="连不上网络" body="检查一下手机网络，恢复后会自动重连。" />
      ) : !loaded ? (
        <div className="flex items-center justify-center gap-2 py-16 text-meta text-fg-muted">
          <Spinner /> 正在连接电脑…
        </div>
      ) : (
        <div className="flex flex-col gap-5 pb-6">
          {!ready && (
            <Banner tone="warn" icon={<CloudOff size={18} />}>
              {state ? linkStateText[state] : ''}：下面是断开前的内容，恢复后会自动更新。
            </Banner>
          )}
          {sessions.length === 0 ? (
            <Empty
              icon={Inbox}
              title="还没有任务"
              body="在手机上给电脑派个活儿，结果和改动都能在这里看。"
              action={
                <Button variant="primary" disabled={!canAct} onClick={onNew} className="mt-2">
                  <Plus size={18} /> 新建任务
                </Button>
              }
            />
          ) : (
            <>
              <Group title="等你处理" tone="danger" list={groups.waiting} project={projectName} onOpen={onOpen} />
              <Group title="运行中" tone="online" list={groups.running} project={projectName} onOpen={onOpen} />
              <Group title="最近" list={groups.recent} project={projectName} onOpen={onOpen} />
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
}: {
  title: string
  tone?: 'danger' | 'online'
  list: SessionSummary[]
  project(s: SessionSummary): string
  onOpen(id: string): void
}) {
  if (!list.length) return null
  return (
    <Section
      title={
        <>
          {tone && <Dot tone={tone} pulse={tone === 'online'} />}
          {title}
          <span className="text-fg-faint">{list.length}</span>
        </>
      }
    >
      {list.map((s, i) => (
        <button
          key={s.record.id}
          type="button"
          onClick={() => onOpen(s.record.id)}
          className={cn(
            'flex w-full items-start gap-3 px-4 py-3.5 text-left active:bg-hover',
            i > 0 && 'border-t border-line-subtle',
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cn('line-clamp-2 text-ui', tone === 'danger' && 'font-medium')}>{taskTitle(s)}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-meta text-fg-muted">
              <span className="truncate">{project(s)}</span>
              <span className="shrink-0 text-fg-faint">·</span>
              <span className="shrink-0">{ENGINES[s.record.engine]?.name ?? ''}</span>
              <span className="shrink-0 text-fg-faint">·</span>
              <span className="shrink-0">{ago(s.record.updatedAt)}</span>
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
            {s.state === 'waiting' && <Badge tone="danger">等你处理</Badge>}
            {(s.state === 'running' || s.state === 'starting') && (
              <Badge tone="accent">
                <Spinner size={10} /> 运行中
              </Badge>
            )}
            {!!s.queue?.queued && <Badge>排队 {s.queue.queued}</Badge>}
            {!!s.queue?.failed && <Badge tone="warn">失败 {s.queue.failed}</Badge>}
          </span>
        </button>
      ))}
    </Section>
  )
}
