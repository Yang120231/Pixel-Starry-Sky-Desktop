import { useEffect } from 'react'
import { packName } from '@pixelsky/protocol'
import { useToast } from '@/ui'
import { getLocale, tr } from '@/i18n/core'
import { getFiles, subscribeFiles } from '@/features/files/store'
import { getPackState } from '@/features/extpacks/store'
import { useSettings } from '@/features/settings/SettingsProvider'
import { openExtDetail } from './nav'
import { markRecommended, officialPackFor, shouldRecommend, shownRecommendations } from './recommend'
import { installExtension, storeBridge, subscribeInstallToasts } from './store'

/** 装好 / 失败的提示：状态单例算出来，这里用现成的 Toast 弹（装好带「查看」跳详情） */
export function ExtStoreToastHost() {
  const toast = useToast()
  const settings = useSettings()
  useEffect(
    () =>
      subscribeInstallToasts(t => {
        if (t.kind === 'failed')
          return toast(tr('extstore.toast.failed', { name: t.name, reason: t.reason }), { duration: 4000 })
        const key =
          t.kind === 'rolledBack'
            ? 'extstore.toast.rolledBack'
            : t.kind === 'updated'
              ? 'extstore.toast.updated'
              : 'extstore.toast.installed'
        toast(tr(key, { name: t.name }), {
          action: {
            label: tr('extstore.toast.view'),
            run: () => {
              openExtDetail(t.id)
              settings.openSettings('extensions')
            },
          },
        })
      }),
    [toast, settings],
  )
  // 打开某种语言的文件时推荐对应的官方语言扩展（recommend.ts）：换了当前文件才看一次，同一个扩展同时只问一次商店
  useEffect(() => {
    let lastPath: string | null = null
    const asking = new Set<string>()
    // 这次打开应用里商店没有的（还没上架、连不上）：不再每换一个文件就问一次
    const missing = new Set<string>()
    return subscribeFiles(() => {
      const { tabs, active } = getFiles()
      const path = tabs.find(t => t.id === active)?.path ?? null
      if (!path || path === lastPath) return
      lastPath = path
      const id = officialPackFor(path)
      if (!id || asking.has(id) || missing.has(id) || !shouldRecommend(id, getPackState(), shownRecommendations()))
        return
      asking.add(id)
      void Promise.resolve(storeBridge()?.detail(id))
        .then(detail => {
          // 商店连不上、没有这个扩展：不提示也不记，下次打开应用再试
          if (!detail?.latest) return void missing.add(id)
          markRecommended(id)
          const name = detail.manifest ? packName(detail.manifest, getLocale()) : detail.extension.name
          toast(tr('extstore.recommend.text', { name }), {
            duration: 8000,
            action: {
              label: tr('extstore.recommend.install'),
              run: () => void installExtension(id, detail.latest.version),
            },
          })
        })
        .catch(() => void missing.add(id))
        .finally(() => asking.delete(id))
    })
  }, [toast])
  return null
}
