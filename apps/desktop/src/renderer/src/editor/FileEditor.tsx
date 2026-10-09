import { translateMessage } from '../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, FileText, RefreshCw, Save, FolderTree, WrapText, Columns2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { IconButton, Spinner } from '@/components/ui'
import {
  activateFile,
  checkFile,
  dirtyFile,
  ensureFile,
  getFiles,
  loadFile,
  saveFile,
  updateFile,
  useFiles,
} from '@/files/store'
import { confirmFiles } from '@/files/FileConfirm'
import { CodeEditor } from './code/CodeEditor'
import { fileLanguage } from './code/languages'
import { fileIndent } from './code/positions'
import { ExternalFileButton } from './ExternalFileButton'
import { FileBreadcrumbs } from './FileBreadcrumbs'
import { isDemo } from '@/data'

export function FileEditor({
  id,
  active,
  explorer,
  onMoveToChat,
}: {
  id: string
  active: boolean
  explorer?: ReactNode
  onMoveToChat?: () => void
}) {
  useI18n()
  const [treeOpen, setTreeOpen] = useState(() => localStorage.getItem('pixelsky.editor.tree') !== 'false')
  const [narrow, setNarrow] = useState(false),
    [drawerOpen, setDrawerOpen] = useState(false)
  const container = useRef<HTMLElement>(null)
  const treeVisible = treeOpen && (!narrow || drawerOpen)
  const [wordWrap, setWordWrap] = useState(() => localStorage.getItem('pixelsky.editor.wrap') === 'true')
  const files = useFiles(),
    tab = files.tabs.find(t => t.id === id),
    [preview, setPreview] = useState(() => getFiles().tabs.find(t => t.id === id)?.preview ?? false)
  useEffect(() => {
    void ensureFile(id)
  }, [id])
  useEffect(() => {
    if (active) {
      activateFile(id)
      void checkFile(id)
    }
  }, [active, id])
  useLayoutEffect(() => {
    const el = container.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const small = el.clientWidth < 660
      setNarrow(small)
      if (!small) setDrawerOpen(false)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [id, !!tab?.document])
  if (!tab || (tab.loading && !tab.document))
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-meta text-fg-muted">
        <Spinner size={14} />
        {tr('editor.FileEditor.message456')}
      </div>
    )
  const doc = tab.document,
    readonly = doc?.kind === 'text' && doc.readonly
  return (
    <section
      ref={container}
      data-file-editor={id}
      className="@container/filepane flex min-h-0 min-w-0 flex-1 flex-col"
      onFocusCapture={() => {
        if (active) void checkFile(id)
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line-layout px-3">
        <FileBreadcrumbs tab={tab} />
        {fileLanguage(tab.path) === 'Markdown' && (
          <IconButton
            icon={Eye}
            size={28}
            iconSize={15}
            label={preview ? tr('editor.FileEditor.message457') : tr('editor.FileEditor.message458')}
            active={preview}
            onClick={() => {
              setPreview(v => !v)
              updateFile(id, { preview: !preview })
            }}
          />
        )}
        {doc?.kind === 'text' && (
          <IconButton
            icon={Save}
            size={28}
            iconSize={15}
            label={tr('editor.FileEditor.message459')}
            disabled={!!readonly || !dirtyFile(tab) || tab.saving || isDemo}
            onClick={() => void saveFile(id)}
          />
        )}
        <IconButton
          icon={RefreshCw}
          size={28}
          iconSize={15}
          label={tr('editor.FileEditor.message460')}
          disabled={tab.loading || tab.saving}
          onClick={() => {
            void confirmFiles([id], tr('editor.FileEditor.message461')).then(ok => {
              if (ok) void loadFile(id)
            })
          }}
        />
        <ExternalFileButton tab={tab} />
        {doc?.kind === 'text' && (
          <IconButton
            icon={WrapText}
            size={28}
            iconSize={15}
            label={tr('workspace.wrap')}
            active={wordWrap}
            aria-pressed={wordWrap}
            onClick={() => {
              setWordWrap(v => !v)
              localStorage.setItem('pixelsky.editor.wrap', String(!wordWrap))
            }}
          />
        )}
        {onMoveToChat && (
          <IconButton icon={Columns2} size={28} iconSize={15} label={tr('workspace.moveChat')} onClick={onMoveToChat} />
        )}
        {explorer && (
          <IconButton
            icon={FolderTree}
            size={28}
            iconSize={15}
            label={tr(treeVisible ? 'workspace.hideTree' : 'workspace.tree')}
            active={treeVisible}
            aria-expanded={treeVisible}
            onClick={() => {
              if (narrow) {
                setTreeOpen(true)
                setDrawerOpen(v => !v)
              } else {
                setTreeOpen(v => !v)
                localStorage.setItem('pixelsky.editor.tree', String(!treeOpen))
              }
            }}
          />
        )}
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {tab.external && (
            <div
              role="status"
              className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-subtle px-3 py-2 text-meta text-fg"
            >
              <span className="flex-1">{tr('editor.FileEditor.message462')}</span>
              <button
                className="text-accent-fg hover:underline"
                onClick={() => {
                  void confirmFiles([id], tr('editor.FileEditor.message461')).then(ok => {
                    if (ok) void loadFile(id)
                  })
                }}
              >
                {tr('editor.FileEditor.message461')}
              </button>
              <button
                className="text-fg-secondary hover:underline"
                onClick={() =>
                  updateFile(id, {
                    ignoredVersion: tab.external?.kind === 'text' ? tab.external.version : null,
                    external: null,
                  })
                }
              >
                {tr('editor.FileEditor.message463')}
              </button>
            </div>
          )}
          {tab.error && (
            <div role="status" className="flex shrink-0 items-start gap-2 px-3 py-2 text-meta text-danger">
              <span className="flex-1">{translateMessage(tab.error)}</span>
              <button aria-label={tr('editor.FileEditor.message464')} onClick={() => updateFile(id, { error: null })}>
                {tr('editor.code.theme.message425')}
              </button>
            </div>
          )}
          {readonly && (
            <p className="shrink-0 bg-subtle px-3 py-2 text-meta text-fg-muted">{tr('editor.FileEditor.message465')}</p>
          )}
          {doc?.kind === 'text' ? (
            <>
              <div className={preview ? 'hidden' : 'flex min-h-0 flex-1'} inert={preview}>
                <CodeEditor tab={tab} active={active && !preview} wordWrap={wordWrap} />
              </div>
              {preview && (
                <div
                  data-markdown-preview
                  className="prose min-h-0 flex-1 overflow-auto px-5 py-4 text-prose text-fg-body"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{tab.draft}</ReactMarkdown>
                </div>
              )}
              <footer className="flex min-h-7 shrink-0 flex-wrap items-center justify-end gap-x-3 border-t border-line-layout px-3 py-1 text-label text-fg-muted">
                {tab.saving && <span className="mr-auto">{tr('editor.FileEditor.message466')}</span>}
                {dirtyFile(tab) && !tab.saving && <span className="mr-auto">{tr('editor.FileEditor.message467')}</span>}
                <span>
                  {tr('editor.FileEditor.message468')} {tab.cursor.line}
                  {tr('editor.FileEditor.message469')} {tab.cursor.column}
                </span>
                <span>{fileLanguage(tab.path)}</span>
                <span>UTF-8{doc.bom ? ' BOM' : ''}</span>
                <span>{doc.newline.toUpperCase()}</span>
                <span>{fileIndent(tab.draft).label}</span>
              </footer>
            </>
          ) : doc?.kind === 'image' ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
              <img alt={tab.name} src={doc.dataUrl} className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-ui text-fg-muted">
              <FileText size={24} />
              <p>{doc?.kind === 'unsupported' ? doc.reason : tr('editor.FileEditor.message470')}</p>
              <p className="text-meta">{tr('editor.FileEditor.message471')}</p>
            </div>
          )}
        </div>
        {explorer && treeVisible && (
          <aside
            data-editor-explorer
            className="flex w-[32%] min-w-52 max-w-72 shrink-0 flex-col border-l border-line-layout bg-panel @max-[660px]/filepane:absolute @max-[660px]/filepane:inset-y-0 @max-[660px]/filepane:right-0 @max-[660px]/filepane:z-20 @max-[660px]/filepane:w-60 @max-[660px]/filepane:shadow-menu"
          >
            {explorer}
          </aside>
        )}
      </div>
    </section>
  )
}
