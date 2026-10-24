// 产物（docs/mobile-remote.md §18.4，同电脑的产物面板）：这个项目最近 AI 改过的文件（按轮）和交给你的文件。
// 点文件看那次改动（交给你的文件也是：看写它的那次改动），点一轮的标题打开那个会话。
import { useState } from 'react'
import { ChevronRight, FileDiff, Package } from 'lucide-react'
import type { ArtifactResponse, Item } from '@pixelsky/protocol'
import { ago } from '@/data/tasks'
import { fileSize, useToolData } from '@/data/tools'
import { L } from '@/i18n'
import { Banner, DiffView, Empty, Section, Segmented, cn } from '@/ui'
import { Loading, PathRow, ToolFrame, type ToolProps } from './common'

type Days = '1' | '7' | '30'

const dayOptions = (): readonly { value: Days; label: string }[] => [
  { value: '1', label: L('今天', 'Today') },
  { value: '7', label: L('7 天', '7 days') },
  { value: '30', label: L('30 天', '30 days') },
]

const deliveryText = (): Record<string, string> => ({
  document: L('文档', 'Document'),
  image: L('图片', 'Image'),
  table: L('表格', 'Spreadsheet'),
  web: L('网页', 'Web page'),
  archive: L('压缩包', 'Archive'),
  media: L('音视频', 'Media'),
  other: L('文件', 'File'),
})

interface ChangeTarget {
  sessionId: string
  itemId: string
  path: string
}

export function ArtifactsScreen(props: ToolProps) {
  const target = props.sub ? (JSON.parse(props.sub) as ChangeTarget) : null
  return target ? <ChangePage tool={props} target={target} /> : <ListPage tool={props} />
}

function ListPage({ tool }: { tool: ToolProps }) {
  const [days, setDays] = useState<Days>('7')
  const list = useToolData<ArtifactResponse>(tool.deviceId, 'engine:artifacts', [
    { projectId: tool.project.id, days: Number(days) },
  ])
  const r = list.data
  const turns = r?.turns.filter(t => t.files.length) ?? []
  return (
    <ToolFrame tool={tool} title={L('产物', 'Artifacts')} loading={list.loading} onRefresh={list.reload}>
      <div className="px-4 pt-1 pb-4">
        <Segmented<Days> options={dayOptions()} value={days} onChange={setDays} />
      </div>
      {!r ? (
        <Loading error={list.error} />
      ) : !turns.length && !r.delivered.length ? (
        <Empty
          icon={Package}
          title={L('没有产物', 'No artifacts')}
          body={L(
            '这段时间 AI 没有在这个项目里改过文件。',
            'AI didn’t change any files in this project during this period.',
          )}
        />
      ) : (
        <div className="flex flex-col gap-5 pb-6">
          {list.error && <Banner tone="danger">{list.error}</Banner>}
          {r.delivered.length > 0 && (
            <Section title={L('交给你的', 'Delivered to you')}>
              {r.delivered.map((d, i) => (
                <PathRow
                  key={d.sessionId + d.itemId + d.path}
                  path={d.local ?? d.path}
                  first={i === 0}
                  onClick={() =>
                    tool.onSub(
                      JSON.stringify({ sessionId: d.sessionId, itemId: d.itemId, path: d.path } satisfies ChangeTarget),
                    )
                  }
                  badge={
                    <span className="shrink-0 text-label text-fg-faint">
                      {deliveryText()[d.type] ?? L('文件', 'File')}
                    </span>
                  }
                  trailing={
                    <span className="pr-2 text-label text-fg-faint">
                      {d.exists ? (d.bytes !== null ? fileSize(d.bytes) : '') : L('已删除', 'Deleted')}
                    </span>
                  }
                />
              ))}
            </Section>
          )}
          {turns.map(t => (
            <Section key={t.sessionId + (t.userItemId ?? t.at)}>
              <button
                type="button"
                onClick={() => tool.onOpenSession(t.sessionId)}
                className="flex w-full items-start gap-2 border-b border-line-subtle px-4 py-3 text-left active:bg-hover"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-2 text-ui">{t.prompt || t.title}</span>
                  <span className="truncate text-meta text-fg-muted">
                    {t.prompt && t.title && t.title !== t.prompt ? t.title + ' · ' : ''}
                    {ago(t.at)}
                  </span>
                </span>
                <ChevronRight size={16} className="mt-1 shrink-0 text-fg-faint" />
              </button>
              {t.files.map((f, i) => (
                <PathRow
                  key={f.path}
                  path={f.local ?? f.path}
                  first={i === 0}
                  onClick={() =>
                    tool.onSub(
                      JSON.stringify({ sessionId: t.sessionId, itemId: f.itemId, path: f.path } satisfies ChangeTarget),
                    )
                  }
                  icon={<FileDiff size={17} strokeWidth={1.75} className="shrink-0 text-fg-muted" />}
                  badge={
                    f.kind !== 'update' && (
                      <span className={cn('shrink-0 text-label', f.kind === 'add' ? 'text-success' : 'text-danger')}>
                        {f.kind === 'add' ? L('新建', 'New') : L('删除', 'Deleted')}
                      </span>
                    )
                  }
                  trailing={
                    <span className="pr-2 font-mono text-meta">
                      <span className="text-success">+{f.added}</span> <span className="text-danger">−{f.removed}</span>
                    </span>
                  }
                />
              ))}
            </Section>
          ))}
          {r.outsideCount > 0 && (
            <p className="px-5 text-label text-fg-faint">
              {L(
                `另有 ${r.outsideCount} 个项目目录外的文件被改过，请到电脑上看。`,
                `${r.outsideCount} ${r.outsideCount === 1 ? 'file' : 'files'} outside the project folder ${r.outsideCount === 1 ? 'was' : 'were'} changed. View them on your computer.`,
              )}
            </p>
          )}
          {(r.truncated || r.partial) && (
            <p className="px-5 text-label text-fg-faint">
              {L('记录较多，只列出了最近的一部分。', 'Too many records. Only the most recent are listed.')}
            </p>
          )}
        </div>
      )}
    </ToolFrame>
  )
}

function ChangePage({ tool, target }: { tool: ToolProps; target: ChangeTarget }) {
  const change = useToolData<Extract<Item, { kind: 'file_change' }> | null>(tool.deviceId, 'engine:artifactChange', [
    { sessionId: target.sessionId, itemId: target.itemId },
  ])
  const c = change.data?.changes.find(x => x.path === target.path) ?? change.data?.changes[0]
  return (
    <ToolFrame
      tool={tool}
      title={target.path.split(/[\\/]/).pop()}
      subtitle={<span className="font-mono">{target.path}</span>}
      loading={change.loading}
      onRefresh={change.reload}
      actions={
        <button
          type="button"
          onClick={() => tool.onOpenSession(target.sessionId)}
          className="mr-1 min-h-9 rounded-full px-3 text-meta text-accent-fg active:bg-hover"
        >
          {L('打开会话', 'Open conversation')}
        </button>
      }
    >
      {change.loaded && !change.data ? (
        <Empty
          icon={FileDiff}
          title={L('找不到这次改动', 'Change not found')}
          body={L('会话记录可能已经被清掉。', 'The conversation history may have been cleared.')}
        />
      ) : !c ? (
        <Loading error={change.error} />
      ) : (
        <div className="flex flex-col gap-2 pt-2 pb-6">
          <div className="flex items-center gap-3 px-4 font-mono text-meta">
            <span className="text-success">+{c.added}</span>
            <span className="text-danger">−{c.removed}</span>
          </div>
          <div className="mx-3 overflow-hidden rounded-xl border border-line-subtle bg-surface">
            <DiffView diff={c.diff} />
          </div>
        </div>
      )}
    </ToolFrame>
  )
}
