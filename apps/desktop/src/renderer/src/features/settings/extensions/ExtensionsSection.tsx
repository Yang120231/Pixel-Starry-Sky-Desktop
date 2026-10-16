import { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { usePackState } from '@/features/extpacks/store'
import { openExtDetail, openExtTab, trackExtPage, useExtDetail, useExtTab } from '@/features/extstore/nav'
import { touchExtStore } from '@/features/extstore/store'
import { SectionTitle } from '../SettingRow'
import { DiscoverTab } from './DiscoverTab'
import { ExtTabs } from './ExtTabs'
import { InstalledTab } from './InstalledTab'
import type { PackGroup } from './model'

/** 设置 › 扩展：顶上「发现 | 已安装 N | 我的发布」三个页签；旧入口进来停在「已安装」 */
export function ExtensionsSection({ initialGroup }: { initialGroup?: PackGroup }) {
  const { t } = useI18n()
  const tab = useExtTab()
  const detail = useExtDetail()
  const installedCount = usePackState().packs.length

  // 打开扩展页：让主进程读一次停用名单，超过 10 分钟没查过更新就查一次；关掉设置后页签放回「已安装」
  useEffect(() => {
    touchExtStore()
    return trackExtPage()
  }, [])

  return (
    <section data-setting-title={tr('extensions.title')}>
      <SectionTitle>{tr('extensions.title')}</SectionTitle>
      <p className="mb-4 text-meta text-fg-muted">{t('extensions.description')}</p>
      <ExtTabs value={tab} onChange={openExtTab} installedCount={installedCount} />
      {tab === 'discover' ? (
        detail ? (
          <DetailPlaceholder id={detail} onBack={() => openExtDetail(null)} />
        ) : (
          <DiscoverTab />
        )
      ) : tab === 'publish' ? (
        <p className="rounded-lg border border-line px-3 py-6 text-center text-ui text-fg-faint">
          {t('extstore.publish.soon')}
        </p>
      ) : (
        <InstalledTab initialGroup={initialGroup} />
      )}
    </section>
  )
}

/** 7.4c 才做详情页：先放一个能返回的占位，发现页的搜索词 / 分类 / 滚动位置返回后还在 */
function DetailPlaceholder({ id, onBack }: { id: string; onBack(): void }) {
  const { t } = useI18n()
  return (
    <div data-store-detail={id}>
      <button
        type="button"
        onClick={onBack}
        className="press no-drag mb-3 inline-flex items-center gap-1 text-ui text-fg-muted hover:text-fg"
      >
        <ArrowLeft size={14} strokeWidth={1.5} />
        {t('extstore.detail.back')}
      </button>
      <p className="rounded-lg border border-line px-3 py-6 text-center text-ui text-fg-faint">
        {t('extstore.detail.soon')}
        <span className="ml-1 text-fg-muted">{id}</span>
      </p>
    </div>
  )
}
