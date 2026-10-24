// 文件（docs/mobile-remote.md §18.4）：浏览项目目录，打开看文件（只读，代码高亮、图片）。
// 路径都相对项目目录，越界由电脑按项目目录校验（和电脑上的文件面板同一套）。
import { ChevronRight, File, FileImage, Folder, FolderOpen } from 'lucide-react'
import { fileSize, useToolData, type DirectoryListing, type FileDocument } from '@/data/tools'
import { L } from '@/i18n'
import { Banner, Empty, Section, cn } from '@/ui'
import { CopyButton, FileText, langOf } from '@/ui/code'
import { Loading, splitPath, ToolFrame, type ToolProps } from './common'

/** sub：「d:路径」是目录，「f:路径」是文件；null 是项目根目录 */
export function FilesScreen(props: ToolProps) {
  const sub = props.sub ?? 'd:'
  const path = sub.slice(2)
  return sub.startsWith('f:') ? <FilePage tool={props} path={path} /> : <DirectoryPage tool={props} path={path} />
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

function DirectoryPage({ tool, path }: { tool: ToolProps; path: string }) {
  const list = useToolData<DirectoryListing>(tool.deviceId, 'files:list', [{ projectId: tool.project.id }, path])
  const parts = path ? path.split('/') : []
  return (
    <ToolFrame
      tool={tool}
      title={path ? splitPath(path).name : L('文件', 'Files')}
      loading={list.loading}
      onRefresh={list.reload}
    >
      {parts.length > 0 && (
        <nav
          aria-label={L('路径', 'Path')}
          className="flex flex-wrap items-center gap-0.5 px-4 pt-2 pb-3 text-meta text-fg-muted"
        >
          <button type="button" onClick={() => tool.onSub('d:')} className="rounded px-1 py-0.5 active:bg-hover">
            {tool.project.name}
          </button>
          {parts.map((p, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <ChevronRight size={13} className="text-fg-faint" />
              <button
                type="button"
                disabled={i === parts.length - 1}
                onClick={() => tool.onSub('d:' + parts.slice(0, i + 1).join('/'))}
                className="rounded px-1 py-0.5 active:bg-hover disabled:text-fg"
              >
                {p}
              </button>
            </span>
          ))}
        </nav>
      )}
      {!list.data ? (
        <Loading error={list.error} />
      ) : !list.data.entries.length ? (
        <Empty icon={FolderOpen} title={L('空文件夹', 'Empty folder')} />
      ) : (
        <div className="flex flex-col gap-3 pt-1 pb-6">
          {list.error && <Banner tone="danger">{list.error}</Banner>}
          <Section>
            {list.data.entries.map((e, i) => {
              const Icon = e.kind === 'directory' ? Folder : IMAGE.test(e.name) ? FileImage : File
              return (
                <button
                  key={e.path}
                  type="button"
                  onClick={() => tool.onSub((e.kind === 'directory' ? 'd:' : 'f:') + e.path)}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-hover',
                    i > 0 && 'border-t border-line-subtle',
                  )}
                >
                  <Icon
                    size={19}
                    strokeWidth={1.75}
                    className={cn('shrink-0', e.kind === 'directory' ? 'text-accent-fg' : 'text-fg-muted')}
                  />
                  <span className="min-w-0 flex-1 truncate text-ui">{e.name}</span>
                  {e.status && <span className="shrink-0 font-mono text-label text-warn">{e.status}</span>}
                  {e.kind === 'directory' && <ChevronRight size={16} className="shrink-0 text-fg-faint" />}
                </button>
              )
            })}
          </Section>
          {list.data.truncated && (
            <p className="px-5 text-label text-fg-faint">
              {L('文件太多，只列出了一部分。', 'Too many files. Only some are listed.')}
            </p>
          )}
        </div>
      )}
    </ToolFrame>
  )
}

function FilePage({ tool, path }: { tool: ToolProps; path: string }) {
  const file = useToolData<FileDocument>(tool.deviceId, 'files:read', [{ projectId: tool.project.id }, path])
  const doc = file.data
  const { name, dir } = splitPath(path)
  return (
    <ToolFrame
      tool={tool}
      title={name}
      subtitle={<span className="font-mono">{dir || tool.project.name}</span>}
      loading={file.loading}
      onRefresh={file.reload}
      actions={doc?.kind === 'text' && <CopyButton text={doc.content} className="mr-1" />}
    >
      {!doc ? (
        <Loading error={file.error} />
      ) : doc.kind === 'image' ? (
        <div className="flex flex-col items-center gap-2 p-4">
          <img src={doc.dataUrl} alt={name} className="max-w-full rounded-lg border border-line-subtle bg-subtle" />
          <span className="text-label text-fg-faint">{fileSize(doc.bytes)}</span>
        </div>
      ) : doc.kind === 'unsupported' ? (
        <Empty
          icon={File}
          title={L('不能在手机上打开', 'Can’t open on the phone')}
          body={L(`${doc.reason}（${fileSize(doc.bytes)}）`, `${doc.reason} (${fileSize(doc.bytes)})`)}
        />
      ) : (
        <div className="flex flex-col pb-6">
          {doc.cut && (
            <Banner tone="warn">
              {L(
                '文件太长，只显示了开头一部分，完整的请到电脑上看。',
                'File too long. Only the beginning is shown; view the full file on your computer.',
              )}
            </Banner>
          )}
          <FileText code={doc.content} lang={langOf(path)} />
        </div>
      )}
    </ToolFrame>
  )
}
