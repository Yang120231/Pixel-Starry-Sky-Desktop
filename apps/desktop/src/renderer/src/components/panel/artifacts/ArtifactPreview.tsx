import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, ExternalLink, FileCode2, FolderOpen } from 'lucide-react'
import { IconButton, Segmented, Spinner } from '@/components/ui'
import { Markdown } from '@/components/session/live/Markdown'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import type { ArtifactDelivery } from '@pixelsky/protocol'
import type { ArtifactPreview as Preview } from '../../../../../shared/types/artifacts'
import { formatBytes, splitArtifactPath } from './artifactsModel'
import { demo as demoData } from '@/data/demo'

/** 交付文件的预览（docs/ui/artifacts-panel.md §3）：Markdown / 文本 / 图片 / 无脚本网页；PDF 和其他类型用默认应用打开 */
export function ArtifactPreview({
  item,
  demo,
  remote,
  onBack,
  onOpenInEditor,
  onError,
}: {
  item: ArtifactDelivery
  demo: boolean
  remote: boolean
  onBack: () => void
  onOpenInEditor?: () => void
  onError: (message: string) => void
}) {
  useI18n()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [source, setSource] = useState(false)
  useEffect(() => {
    let gone = false
    setPreview(null)
    setError('')
    if (demo) {
      setPreview(demoData().artifacts.preview(item.path))
      return
    }
    window.pixelsky!.artifacts.read({ sessionId: item.sessionId, path: item.absolute }).then(
      p => {
        if (!gone) setPreview(p)
      },
      e => {
        if (!gone) setError((e as Error).message)
      },
    )
    return () => {
      gone = true
    }
  }, [item.absolute, item.sessionId])
  const target = { sessionId: item.sessionId, path: item.absolute }
  const act = (fn: () => Promise<void>) => {
    if (!demo) fn().catch(e => onError((e as Error).message))
  }
  const { name, dir } = splitArtifactPath(item.local ?? item.absolute)
  const renderable = preview?.kind === 'text' && preview.format !== 'plain'
  return (
    <div data-artifact-preview className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line-subtle px-2 py-1.5">
        <IconButton icon={ArrowLeft} label={tr('artifacts.back')} size={28} iconSize={15} onClick={onBack} />
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-list font-medium text-fg" title={item.absolute}>
            {name}
          </div>
          <div className="truncate text-meta text-fg-faint">
            {[dir, preview && 'bytes' in preview ? formatBytes(preview.bytes) : ''].filter(Boolean).join(' · ')}
          </div>
        </div>
        {onOpenInEditor && (
          <IconButton
            icon={FileCode2}
            label={tr('artifacts.openFile')}
            size={26}
            iconSize={14}
            onClick={onOpenInEditor}
          />
        )}
        <IconButton
          icon={ExternalLink}
          label={remote ? tr('artifacts.remoteOnly') : tr('artifacts.open')}
          size={26}
          iconSize={14}
          disabled={remote || !item.exists}
          onClick={() => act(() => window.pixelsky!.artifacts.open(target))}
        />
        <IconButton
          icon={FolderOpen}
          label={remote ? tr('artifacts.remoteOnly') : tr('artifacts.reveal')}
          size={26}
          iconSize={14}
          disabled={remote || !item.exists}
          onClick={() => act(() => window.pixelsky!.artifacts.reveal(target))}
        />
        <IconButton
          icon={Copy}
          label={tr('artifacts.copyPath')}
          size={26}
          iconSize={14}
          onClick={() => void navigator.clipboard.writeText(item.absolute).catch(() => {})}
        />
      </div>
      {renderable && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5">
          <Segmented
            label={tr('artifacts.view')}
            value={source ? 'source' : 'rendered'}
            onChange={v => setSource(v === 'source')}
            options={[
              { value: 'rendered', label: tr('artifacts.rendered') },
              { value: 'source', label: tr('artifacts.source') },
            ]}
          />
          {preview?.kind === 'text' && preview.format === 'html' && !source && (
            <span className="text-meta text-fg-faint">{tr('artifacts.htmlNote')}</span>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p role="alert" className="m-3 rounded-md bg-subtle p-2 text-meta text-danger">
            {translateMessage(error)}
          </p>
        ) : !preview ? (
          <div className="flex items-center justify-center gap-2 p-6 text-meta text-fg-muted">
            <Spinner size={13} />
            {tr('projectTools.loading')}
          </div>
        ) : preview.kind === 'missing' ? (
          <Notice text={tr('artifacts.fileMissing')} />
        ) : preview.kind === 'unsupported' ? (
          <Notice text={tr(preview.reason === 'tooLarge' ? 'artifacts.tooLarge' : 'artifacts.binary')} />
        ) : preview.kind === 'pdf' ? (
          <Notice text={tr('artifacts.pdf')} />
        ) : preview.kind === 'image' ? (
          <div className="flex justify-center p-3">
            <img
              src={preview.dataUrl}
              alt={name}
              className="max-w-full rounded-md border border-line-subtle object-contain"
            />
          </div>
        ) : (
          <>
            {preview.truncated && (
              <p className="mx-3 mt-3 rounded-md bg-subtle px-2.5 py-1.5 text-meta text-warn">
                {tr('artifacts.truncatedPreview')}
              </p>
            )}
            {preview.format === 'markdown' && !source ? (
              <div className="p-4">
                <Markdown text={preview.content} />
              </div>
            ) : preview.format === 'html' && !source ? (
              <iframe
                title={name}
                sandbox=""
                srcDoc={preview.content}
                className="h-full min-h-[480px] w-full border-0 bg-white"
              />
            ) : (
              <pre className="selectable p-3 font-mono text-meta whitespace-pre-wrap break-words text-fg-body">
                {preview.content}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <p className="m-3 rounded-md bg-subtle p-3 text-center text-meta text-fg-muted">{text}</p>
}
