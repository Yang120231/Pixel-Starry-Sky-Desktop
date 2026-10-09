import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Button, Slider } from '@/components/ui'
import {
  WALLPAPER_ACCEPT,
  removeWallpaper,
  setWallpaperFile,
  setWallpaperPrefs,
  useWallpaper,
} from '@/appearance/wallpaper'
import { SettingRow } from './SettingRow'

/** 外观 → 壁纸：选择图片或视频、透出程度、模糊（docs/ui/settings.md §6，参考 Mirasim「背景」） */
export function WallpaperSettings() {
  useI18n()
  const wp = useWallpaper()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onPick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(await setWallpaperFile(file))
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <>
      <SettingRow
        title={tr('settings.searchIndex.message910')}
        description={tr('settings.WallpaperSettings.message1029')}
        hint={error ?? undefined}
        hintTone={error ? 'danger' : 'muted'}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-[72px] w-[128px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-subtle">
            {wp.url ? (
              wp.kind === 'video' ? (
                <video src={wp.url} muted autoPlay loop playsInline className="h-full w-full object-cover" />
              ) : (
                <img
                  src={wp.url}
                  alt={tr('settings.WallpaperSettings.message1030')}
                  className="h-full w-full object-cover"
                />
              )
            ) : (
              <span className="text-meta text-fg-faint">
                {wp.name ? tr('session.live.SessionStrips.message276') : tr('settings.WallpaperSettings.message1031')}
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex gap-2">
              <Button icon={ImagePlus} disabled={busy} onClick={() => inputRef.current?.click()}>
                {wp.name ? tr('settings.WallpaperSettings.message1032') : tr('settings.WallpaperSettings.message1033')}
              </Button>
              {wp.name && (
                <Button variant="ghost" icon={Trash2} onClick={() => void removeWallpaper()}>
                  {tr('ui.Chip.message411')}{' '}
                </Button>
              )}
            </div>
            {wp.name && (
              <span className="truncate text-meta text-fg-muted" title={wp.name}>
                {wp.name}
              </span>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={WALLPAPER_ACCEPT}
            className="hidden"
            onChange={e => void onPick(e.target.files?.[0])}
          />
        </div>
      </SettingRow>

      {wp.name && (
        <>
          <SettingRow
            title={tr('settings.searchIndex.message912')}
            description={tr('settings.WallpaperSettings.message1034')}
          >
            <Slider
              label={tr('settings.searchIndex.message912')}
              min={10}
              max={90}
              step={5}
              value={Math.round(wp.show * 100)}
              onChange={v => setWallpaperPrefs({ show: v / 100 })}
              display={`${Math.round(wp.show * 100)}%`}
            />
          </SettingRow>
          <SettingRow
            title={tr('settings.searchIndex.message914')}
            description={tr('settings.WallpaperSettings.message1035')}
          >
            <Slider
              label={tr('settings.searchIndex.message914')}
              min={0}
              max={20}
              value={wp.blur}
              onChange={v => setWallpaperPrefs({ blur: v })}
              display={`${wp.blur}px`}
            />
          </SettingRow>
        </>
      )}
    </>
  )
}
