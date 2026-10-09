import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, Segmented } from '@/components/ui'
import { GroupTitle, SectionTitle, SettingRow } from '../SettingRow'
import { refreshEditors, setEditors, useEditors } from '@/editor/store'
import { isDemo } from '@/mock/data'
import type { EditorKind } from '../../../../preload/workspace'
import { EditorIcon, editorLabel, editorSource } from '@/editor/EditorIcon'

export function EditorSection() {
  useI18n()
  const state = useEditors(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [name, setName] = useState(tr('settings.editor.EditorSection.message694')),
    [mode, setMode] = useState<'folder' | 'code'>('folder')
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      if (isDemo) throw new Error(tr('settings.editor.EditorSection.message695'))
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void refreshEditors().catch(e => setError(e.message))
  }, [])
  const choose = (kind: EditorKind): void => {
    void run(async () => {
      const result = await window.pixelsky!.editor.choose(kind, name, mode)
      if (result) setEditors(result)
    })
  }
  return (
    <section>
      <SectionTitle>{tr('settings.editor.EditorSection.message696')}</SectionTitle>
      <p className="mt-2 mb-4 text-ui text-fg-muted">{tr('settings.editor.EditorSection.message697')}</p>
      {error && (
        <p role="status" className="mb-3 text-meta text-danger">
          {translateMessage(error)}
        </p>
      )}
      <SettingRow
        title={tr('settings.editor.EditorSection.message698')}
        description={tr('settings.editor.EditorSection.message699')}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={!state || state.openWith === 'app'}
            disabled={busy || isDemo}
            className="rounded-md border border-line bg-subtle px-3 py-1.5 text-ui text-fg aria-pressed:border-accent aria-pressed:bg-accent-soft"
            onClick={() =>
              void run(async () => setEditors(await window.pixelsky!.editor.preferences({ openWith: 'app' })))
            }
          >
            {tr('ui.Logo.message413')}
          </button>
          {state?.items.map(item => (
            <button
              key={item.id}
              type="button"
              disabled={!item.available || busy || isDemo}
              aria-pressed={state.openWith === item.id}
              title={item.path}
              className="inline-flex items-center gap-2 rounded-md border border-line bg-subtle px-3 py-1.5 text-ui text-fg aria-pressed:border-accent aria-pressed:bg-accent-soft disabled:opacity-50"
              onClick={() =>
                void run(async () =>
                  setEditors(await window.pixelsky!.editor.preferences({ openWith: item.id, defaultId: item.id })),
                )
              }
            >
              <EditorIcon item={item} />
              {editorLabel(item)}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow
        title={tr('settings.editor.EditorSection.message700')}
        description={tr('settings.editor.EditorSection.message701')}
      >
        <div className="flex flex-wrap gap-2">
          {state?.items.map(item => (
            <button
              key={item.id}
              type="button"
              disabled={!item.available || busy || isDemo}
              onClick={() =>
                void run(async () => setEditors(await window.pixelsky!.editor.preferences({ defaultId: item.id })))
              }
              title={item.path}
              aria-pressed={state.defaultId === item.id}
              className="inline-flex items-center gap-2 rounded-md border border-line bg-subtle px-3 py-1.5 text-ui text-fg aria-pressed:border-accent aria-pressed:bg-accent-soft disabled:opacity-50"
            >
              <EditorIcon item={item} />
              {editorLabel(item)}
              {!item.available && tr('editor.EditorButton.message444')}
            </button>
          ))}
          {state?.items.length === 0 && (
            <span className="text-meta text-fg-muted">{tr('settings.editor.EditorSection.message702')}</span>
          )}
        </div>
      </SettingRow>
      <SettingRow
        title={tr('settings.editor.EditorSection.message703')}
        description={tr('settings.editor.EditorSection.message704')}
      >
        <Segmented
          label={tr('settings.editor.EditorSection.message705')}
          value={state?.window ?? 'reuse'}
          options={[
            {
              value: 'reuse',
              get label() {
                return tr('settings.editor.EditorSection.message706')
              },
            },
            {
              value: 'new',
              get label() {
                return tr('settings.editor.EditorSection.message707')
              },
            },
          ]}
          onChange={value =>
            void run(async () => setEditors(await window.pixelsky!.editor.preferences({ window: value })))
          }
        />
      </SettingRow>
      <GroupTitle>{tr('settings.editor.EditorSection.message708')}</GroupTitle>
      <Button
        icon={RefreshCw}
        disabled={busy}
        onClick={() => {
          setError('')
          void refreshEditors(true).catch(e => setError(e.message))
        }}
      >
        {tr('session.SourceHintBar.message369')}
      </Button>
      <div className="mt-3 space-y-2">
        {state?.items.map(item => (
          <div key={item.id} className="rounded-lg border border-line-card bg-subtle p-3">
            <div className="flex items-center gap-2">
              <EditorIcon item={item} />
              <span className="text-ui font-medium text-fg">{editorLabel(item)}</span>
              <span className="ml-auto text-meta text-fg-muted">
                {editorSource(item)} ·{' '}
                {item.available
                  ? tr('settings.editor.EditorSection.message709')
                  : tr('settings.editor.EditorSection.message710')}
              </span>
            </div>
            <p title={item.path} className="mt-1 break-all text-meta text-fg-muted">
              {item.path}
            </p>
            {item.manual && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(async () => setEditors(await window.pixelsky!.editor.remove(item.id)))}
                className="mt-2 text-meta text-accent-fg hover:underline"
              >
                {item.kind === 'custom'
                  ? tr('settings.editor.EditorSection.message711')
                  : tr('settings.editor.EditorSection.message712')}
              </button>
            )}
          </div>
        ))}
        {state?.checkedAt ? (
          <p className="text-meta text-fg-faint">
            {tr('settings.editor.EditorSection.message713')} {new Date(state.checkedAt).toLocaleTimeString('zh-CN')}
          </p>
        ) : null}
      </div>
      <GroupTitle>{tr('settings.editor.EditorSection.message714')}</GroupTitle>
      <div className="flex flex-wrap gap-2">
        {(['trae-cn', 'trae', 'vscode', 'cursor', 'windsurf'] as const).map((kind, i) => (
          <Button key={kind} disabled={busy || isDemo} onClick={() => choose(kind)}>
            {tr('settings.editor.EditorSection.message715')} {['Trae CN', 'Trae', 'VS Code', 'Cursor', 'Windsurf'][i]}
            {tr('settings.editor.EditorSection.message716')}{' '}
          </Button>
        ))}
      </div>
      <GroupTitle>{tr('settings.editor.EditorSection.message694')}</GroupTitle>
      <label className="mb-3 flex items-center gap-3 text-ui text-fg-secondary">
        {tr('settings.editor.EditorSection.message717')}
        <input
          aria-label={tr('settings.editor.EditorSection.message718')}
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={60}
          className="min-w-0 rounded-md border border-line bg-subtle px-3 py-1.5 text-ui text-fg"
        />
      </label>
      <Segmented
        label={tr('settings.editor.EditorSection.message719')}
        value={mode}
        options={[
          {
            value: 'folder',
            get label() {
              return tr('settings.editor.EditorSection.message720')
            },
          },
          {
            value: 'code',
            get label() {
              return tr('settings.editor.EditorSection.message721')
            },
          },
        ]}
        onChange={setMode}
      />
      <div className="mt-3">
        <Button disabled={busy || isDemo || !name.trim()} onClick={() => choose('custom')}>
          {tr('settings.editor.EditorSection.message722')}
        </Button>
      </div>
    </section>
  )
}
