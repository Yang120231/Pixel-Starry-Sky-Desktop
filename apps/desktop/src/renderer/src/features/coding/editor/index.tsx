import { useCallback, useEffect, useMemo, type KeyboardEvent } from 'react'
import { FileText } from 'lucide-react'
import type { Extension } from '@codemirror/state'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { FileEditor } from '@/features/editor/FileEditor'
import { dirtyFile, ensureFile, openFile, setCodeOpener, useFiles, type OpenFile } from '@/features/files/store'
import { CLOSE_TAB, CYCLE_TAB } from '@/features/layout/shortcuts'
import { SPLIT_MIN_WIDTH } from '@/features/panel/git/gitModel'
import { useRecentFiles } from '@/features/panel/recentFiles'
import { parseFileTab } from '@/features/panes/tree'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'
import { useTurnChanges } from '../ai/useTurnChanges'
import { codingLayout } from '../layoutStore'
import { AiReviewBar, useAiReviewExtensions, useTurnBaseline } from '../review'
import { SymbolCrumb, useEditorExtras } from './extras'
import { useCodingSessionId, useCodingWorkspace } from '../workspace'
import {
  activateCodeTab,
  closeCodeTab,
  cycleCodeTab,
  getCodeTabs,
  openCodeTab,
  setCodeProject,
  setCodeView,
  useCodeTabs,
} from './codeTabs'
import { baseName, pathKey } from './codeTabsModel'
import { CodeTabs, type TabItem } from './TabBar'
import { DiffPane } from './DiffPane'
import { effectiveBase, effectiveMode, viewAvailability } from './viewModel'
import type { MenuAction } from '@/ui/ActionMenu'

const EMPTY: readonly Extension[] = []
const caseInsensitive = typeof window !== 'undefined' && window.pixelsky?.platform === 'win32'

/** 中栏当前文件；没有时 null */
export function useActiveCodeTab(): OpenFile | null {
  const { group } = useCodeTabs()
  const files = useFiles()
  return (group.active && files.tabs.find(t => t.id === group.active)) || null
}

/** 打开到中栏并切到「变更」（对比这一轮，算不出来 DiffPane 会退回 HEAD） */
export async function openCodeDiff(ref: WorkspaceRef, path: string): Promise<void> {
  const id = await openFile(ref, path, undefined, 1, undefined, { target: 'code' })
  if (id) setCodeView(id, 'diff', 'turn')
}

/** 没有标签时的空状态：提示加最近打开的文件 */
function EmptyState({ scope }: { scope: string }) {
  useI18n()
  const recent = useRecentFiles(scope)
  return (
    <div
      data-coding-editor-empty
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-ui text-fg-muted"
    >
      <FileText size={24} strokeWidth={1.5} />
      <p>{tr('coding.editor.empty.title')}</p>
      {recent.length > 0 && (
        <div className="flex w-full max-w-72 flex-col gap-0.5 text-left">
          <p className="px-2 pb-1 text-label text-fg-muted">{tr('coding.editor.empty.recent')}</p>
          {recent.map(item => {
            const path = parseFileTab(item.id)?.path ?? item.id
            return (
              <button
                key={item.id}
                type="button"
                title={path}
                className="press flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-ui text-fg hover:bg-hover"
                onClick={() => {
                  void ensureFile(item.id)
                  openCodeTab(item.id)
                }}
              >
                <span className="shrink-0">{baseName(path)}</span>
                <span className="min-w-0 truncate text-meta text-fg-muted">{path}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 中栏：文件标签 + 代码 / 变更 / 并排 三种视图 */
export function EditorArea({ visible, width }: { visible: boolean; width: number }) {
  useI18n()
  const workspace = useCodingWorkspace()
  const { group, views } = useCodeTabs()
  const files = useFiles()
  const turn = useTurnChanges(useCodingSessionId())

  useEffect(() => {
    setCodeOpener(openCodeTab)
    return () => setCodeOpener(null)
  }, [])
  useEffect(() => {
    setCodeProject(workspace.key)
  }, [workspace.key])

  const active = group.active
  const tab = (active && files.tabs.find(t => t.id === active)) || null

  const aiPaths = useMemo(() => new Set((turn?.files ?? []).map(f => pathKey(f.path, caseInsensitive))), [turn])
  const items: TabItem[] = group.tabs.map(id => {
    const file = files.tabs.find(t => t.id === id)
    const path = file?.path ?? parseFileTab(id)?.path ?? id
    return {
      id,
      name: file?.name ?? baseName(path),
      title: path,
      dirty: !!file && dirtyFile(file),
      ai: aiPaths.has(pathKey(path, caseInsensitive)),
    }
  })

  // 两个扩展 hook 都在顶层调用，再合并；两边都为空时用同一个常量，避免多余的 reconfigure
  const review = useAiReviewExtensions(tab)
  const extras = useEditorExtras(tab)
  const merged = useMemo(() => (review.length || extras.length ? [...review, ...extras] : EMPTY), [review, extras])
  const turnBaseline = useTurnBaseline(tab)

  const avail = useMemo(
    () =>
      tab
        ? viewAvailability({
            head: tab.head,
            draft: tab.draft,
            text: tab.document?.kind === 'text',
            turnBaseline,
            width,
            splitMinWidth: SPLIT_MIN_WIDTH,
          })
        : null,
    [tab, turnBaseline, width],
  )
  const saved = active ? views[active] : undefined
  const mode = avail ? effectiveMode(saved?.mode ?? 'code', avail) : 'code'
  const base = avail ? effectiveBase(saved?.base ?? 'head', avail) : 'head'

  const menu = useCallback((): MenuAction[] => {
    const current = getCodeTabs().group.active
    const file = current ? files.tabs.find(t => t.id === current) : undefined
    const closeAll = async (keep: string | null): Promise<void> => {
      for (const id of [...getCodeTabs().group.tabs]) if (id !== keep) await closeCodeTab(id)
    }
    return [
      { label: tr('coding.editor.closeOthers'), disabled: group.tabs.length < 2, run: () => void closeAll(current) },
      { label: tr('coding.editor.closeAll'), run: () => void closeAll(null) },
      {
        label: tr('coding.editor.copyPath'),
        separator: true,
        disabled: !file,
        run: () => file && void navigator.clipboard.writeText(`${file.root.replace(/\/$/, '')}/${file.path}`),
      },
      {
        label: tr('coding.editor.copyRelPath'),
        disabled: !file,
        run: () => file && void navigator.clipboard.writeText(file.path),
      },
      { label: tr('coding.editor.reveal'), disabled: !file, run: () => codingLayout.showLeft('files') },
    ]
  }, [files.tabs, group.tabs.length])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const native = e.nativeEvent
    const delta = CYCLE_TAB.delta(native)
    if (CLOSE_TAB.match(native) && active) {
      e.preventDefault()
      void closeCodeTab(active)
    } else if (delta) {
      e.preventDefault()
      cycleCodeTab(delta > 0 ? 1 : -1)
    }
  }

  return (
    <div data-coding-editor className="flex min-h-0 min-w-0 flex-1 flex-col bg-app" onKeyDownCapture={onKeyDown}>
      <CodeTabs
        tabs={items}
        active={active}
        mode={mode}
        avail={avail}
        onActivate={activateCodeTab}
        onClose={id => void closeCodeTab(id)}
        onMode={next => active && setCodeView(active, next)}
        menu={menu()}
      />
      {!active ? (
        <EmptyState scope={workspace.key} />
      ) : mode === 'code' || !tab ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <FileEditor
            key={active}
            id={active}
            active={visible}
            extensions={merged}
            footer={false}
            crumbExtra={tab ? <SymbolCrumb tab={tab} /> : null}
          />
          <AiReviewBar tabId={active} />
        </div>
      ) : (
        <DiffPane
          key={active}
          tab={tab}
          mode={mode}
          base={base}
          turnBaseline={turnBaseline}
          fellBack={(saved?.base ?? 'head') === 'turn' && base === 'head'}
          onBase={next => setCodeView(active, mode, next)}
        />
      )}
    </div>
  )
}
