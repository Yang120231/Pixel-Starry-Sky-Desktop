import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderPlus, RefreshCw, Search } from 'lucide-react'
import { Button, Segmented } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { useMachines } from '@/features/machines/store'
import { refreshPacks, usePackState } from '@/features/extpacks/store'
import { GroupTitle } from '../SettingRow'
import { PluginsSection } from '../plugins/PluginsSection'
import { filterPacks, type PackGroup } from './model'
import { PackDetail } from './PackDetail'
import { PackList } from './PackList'

const errorText = (e: unknown): string => translateMessage((e as Error)?.message ?? String(e))

/** 「已安装」页签：原来扩展页的全部内容（列表、筛选、从文件夹加载、AI 引擎的插件） */
export function InstalledTab({ initialGroup }: { initialGroup?: PackGroup }) {
  const { locale, t } = useI18n()
  const machines = useMachines()
  const state = usePackState()
  const [group, setGroup] = useState<PackGroup>(initialGroup ?? 'all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aiRef = useRef<HTMLDivElement>(null)
  const bridge = window.pixelsky?.extpacks

  // 从旧入口（输入框 / 、侧栏插件、命令面板）进来时直接滚到 AI 引擎
  useEffect(() => {
    if (initialGroup !== 'ai') return
    const id = window.setTimeout(() => aiRef.current?.scrollIntoView({ block: 'start' }), 0)
    return () => window.clearTimeout(id)
  }, [initialGroup])

  const visible = useMemo(() => filterPacks(state.packs, group, query, locale), [state.packs, group, query, locale])
  const selectedPack = selected ? state.packs.find(p => p.key === selected) : undefined

  const run = async <T,>(job: () => Promise<T> | undefined): Promise<T | undefined> => {
    if (busy) return undefined
    setBusy(true)
    setError(null)
    try {
      const out = await job()
      await refreshPacks()
      return out
    } catch (e) {
      setError(errorText(e))
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const addFolder = async (): Promise<void> => {
    const added = await run(() => bridge?.addFolder(null))
    if (added) setSelected(added.key)
  }

  return (
    <>
      {selectedPack ? (
        <PackDetail key={selectedPack.key} pack={selectedPack} all={state.packs} onClose={() => setSelected(null)} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented<PackGroup>
              label={t('extensions.group.label')}
              value={group}
              onChange={setGroup}
              options={[
                { value: 'all', label: t('extensions.group.all') },
                { value: 'code', label: t('extensions.group.code') },
                { value: 'ai', label: t('extensions.group.ai') },
              ]}
            />
            <label className="flex h-8 min-w-40 flex-1 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-fg-muted focus-within:border-line-strong">
              <Search size={14} strokeWidth={1.5} className="shrink-0" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('extensions.search')}
                aria-label={t('extensions.search')}
                className="no-drag min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg-faint"
              />
            </label>
            <Button
              icon={FolderPlus}
              disabled={busy}
              data-setting-title={tr('extensions.loadFolder')}
              onClick={() => void addFolder()}
            >
              {t('extensions.loadFolder')}
            </Button>
            <Button icon={RefreshCw} disabled={busy} onClick={() => void run(() => bridge?.reload(null))}>
              {t('extensions.reloadAll')}
            </Button>
          </div>
          {error && <p className="mb-3 text-ui text-danger">{error}</p>}
          {visible.length > 0 ? (
            <PackList
              packs={visible}
              selected={selected}
              onSelect={setSelected}
              busy={busy}
              onToggle={(key, on) => void run(() => bridge?.setEnabled(key, on))}
            />
          ) : (
            <p className="rounded-lg border border-line px-3 py-6 text-center text-ui text-fg-faint">
              {state.loading
                ? t('extensions.loading')
                : state.packs.length
                  ? t('extensions.emptyFiltered')
                  : t('extensions.empty')}
            </p>
          )}
          {group !== 'code' && (
            <div ref={aiRef}>
              <GroupTitle>{tr('extensions.aiGroup')}</GroupTitle>
              {machines.currentId === 'local' ? (
                <PluginsSection />
              ) : (
                <p className="mt-3 text-ui text-fg-muted">{t('machines.remoteExtensions')}</p>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
