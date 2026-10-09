import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { Check, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui'
import { TurnStats } from '@/components/session/TurnStats'
import { replyStatsPreview } from '@/mock/replyStats'
import { REPLY_STAT_GROUPS, REPLY_STAT_LABELS, isDefaultReplyStats, resetReplyStats, setReplyStat, useReplyStats } from './replyStats'
import { SettingRow } from './SettingRow'

/** 设置 → 外观 → 对话；预览和真实回复共用 TurnStats。 */
export function ReplyStatsSettings() {
  useI18n()
  const selected = useReplyStats()
  return (
    <SettingRow title={tr("settings.ReplyStatsSettings.message859")} description={tr("settings.ReplyStatsSettings.message860")}>
      <div className="mb-3 rounded-lg border border-line bg-subtle px-3 py-3" aria-label={tr("settings.ReplyStatsSettings.message861")}>
        <div className="mb-2 text-label text-fg-muted">{tr("settings.ReplyStatsSettings.message862")}</div>
        {selected.length > 0 ? (
          <TurnStats usage={replyStatsPreview} />
        ) : (
          <div className="text-meta text-fg-muted">{tr("settings.ReplyStatsSettings.message863")}</div>
        )}
      </div>
      <div className="space-y-4">
        {REPLY_STAT_GROUPS.map(group => (
          <fieldset key={group.label}>
            <legend className="mb-2 text-label font-medium text-fg-muted">{group.label}</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              {group.keys.map((key) => (
                <label key={key} className="group inline-flex cursor-pointer items-center gap-2 text-ui text-fg-secondary">
                  <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selected.includes(key)}
                      onChange={(event) => setReplyStat(key, event.target.checked)}
                      className="peer size-4 cursor-pointer appearance-none rounded-sm border border-line-strong bg-surface checked:border-accent checked:bg-accent group-hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    />
                    <Check size={12} strokeWidth={2.25} aria-hidden="true" className="pointer-events-none absolute inset-0 m-auto text-accent-on opacity-0 peer-checked:opacity-100" />
                  </span>
                  {REPLY_STAT_LABELS[key]}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="mt-3 text-meta text-fg-faint">{tr("settings.ReplyStatsSettings.message864")}</p>
      <Button variant="ghost" icon={RotateCcw} className="mt-3 -ml-3" disabled={isDefaultReplyStats(selected)} onClick={resetReplyStats}>{tr("settings.ReplyStatsSettings.message865")} </Button>
    </SettingRow>
  )
}
