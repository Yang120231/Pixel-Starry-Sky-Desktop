// 输入框卡片里「+」右边的两颗模式胶囊「每步问我」「Sonnet 4.5 · 中」：点哪颗都打开同一个面板，改权限模式、模型、强度（C2，docs/mobile-remote.md §21.5）。
// 没有外层容器和边距，由输入框那一排摆放；地方不够时胶囊自己收窄、文字截断。
// 改了马上发给电脑（engine:updateSession），电脑推回来的会话记录变了，胶囊跟着变。
// 往更宽的权限切确认一次；完全放行手机上开不了，电脑上已经开着的只能往下降。只看档的手机只能看。
// 能力和模型目录按「下一个引擎」算（运行中选了别的引擎还没生效时，设置算它的，和电脑网关一致）；
// 用自定义接口的会话模型来自那个接口，不在引擎目录里，手机上只显示不让改。
// 快速模式（§25）：引擎有 fast 才显示开关，打开确认一次（按更高的价格计费），开着时模型胶囊末尾「⚡快速」。
import { useState } from 'react'
import { Zap } from 'lucide-react'
import { ENGINES, type Effort, type PermissionMode, type SessionFlags, type SessionRecord } from '@pixelsky/protocol'
import type { DesktopLink } from '@/connection'
import { useCatalog } from '@/data/hooks'
import {
  effortOptions,
  fastConfirm,
  fastStatus,
  modeChip,
  modelLabel,
  modelOptions,
  permissionOptions,
  widens,
} from '@/data/mode'
import { L } from '@/i18n'
import { cn } from '@/ui'
import { ModeSheet } from '@/ui/ModeSheet'

/** 胶囊：和输入框里的圆键同高；两颗都能收窄，文字在里面截断 */
const pill =
  'inline-flex h-9 min-w-0 items-center gap-1 rounded-full border border-line-subtle bg-surface px-3 text-meta text-fg active:bg-hover'

type Patch = Partial<Pick<SessionRecord, 'permissionMode' | 'model' | 'effort' | 'thinkingSummaries' | 'fast'>>

/** 电脑回的错误代码 → 给人看的话；别的原样 */
function errorText(code: string): string {
  switch (code) {
    case 'MOBILE_FORBIDDEN':
      return L('这部手机是「只看」，改不了。', "This phone is set to “View only” and can't change this.")
    case 'MOBILE_UNSUPPORTED':
      return L(
        '电脑上的像素星空版本较旧，先更新电脑版。',
        'The PixelSky app on your computer is out of date. Update it first.',
      )
    case 'MOBILE_BAD_ARGUMENT':
      return L('电脑不接受这个设置。', "The computer didn't accept this setting.")
    default:
      return code
  }
}

export function ModeChip({
  deviceId,
  link,
  sessionId,
  record,
  flags,
  canAct,
}: {
  deviceId: string
  link: DesktopLink | undefined
  sessionId: string
  record: SessionRecord
  /** 快速模式能不能开、是否在冷却（电脑上引擎报告的） */
  flags: SessionFlags | null
  canAct: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const engine = record.nextEngine ?? record.engine
  const custom = !!record.provider
  const catalog = useCatalog(deviceId, engine, open && !custom)
  const chip = modeChip(record)
  const modelText = [chip.model, chip.effort].filter(Boolean).join(' · ') || L('默认', 'Default')
  const caps = ENGINES[engine]?.caps
  const model = catalog.models?.find(m => m.id === record.model)
  const fast = fastStatus(flags)

  const apply = async (patch: Patch) => {
    if (!link) return
    setBusy(true)
    setError(null)
    try {
      await link.call('engine:updateSession', sessionId, patch)
    } catch (e) {
      const code = (e as Error).message
      setError(errorText(code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(pill, 'shrink')}>
        <span className="truncate">{chip.permission}</span>
      </button>
      <button type="button" onClick={() => setOpen(true)} className={cn(pill, 'max-w-44 shrink-[2]')}>
        <span className="truncate">{modelText}</span>
        {record.fast && caps?.fast && (
          <span
            data-fast-chip
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 font-medium',
              fast.cooldown ? 'text-fg-faint line-through' : 'text-warn',
            )}
          >
            <Zap size={13} fill="currentColor" />
            {L('快速', 'Fast')}
          </span>
        )}
      </button>
      {open && (
        <ModeSheet
          title={L('这个会话的模式', 'Conversation mode')}
          busy={busy}
          readOnly={!canAct || catalog.unsupported}
          error={
            error ??
            (catalog.unsupported
              ? L(
                  '电脑上的像素星空版本较旧，手机还不能改模式。',
                  "The PixelSky app on your computer is out of date, so the phone can't change modes yet.",
                )
              : !canAct
                ? L(
                    '没连上电脑，或这部手机是「只看」。',
                    'Not connected to the computer, or this phone is set to “View only”.',
                  )
                : null)
          }
          note={[
            caps &&
              !caps.liveModelSwitch &&
              L('模型和强度下一轮生效。', 'Model and effort changes apply from the next turn.'),
            caps &&
              !caps.livePermissionSwitch &&
              L('正在运行时改权限，下一轮生效。', 'Permission changes made while running apply from the next turn.'),
            caps?.fast
              ? L(
                  '换模型、调高强度、打开快速模式会改变费用。',
                  'Changing the model, raising effort, or turning on fast mode changes the cost.',
                )
              : L('换模型、调高强度会改变费用。', 'Changing the model or raising effort changes the cost.'),
          ]
            .filter(Boolean)
            .join(L('', ' '))}
          onClose={() => setOpen(false)}
          groups={[
            {
              key: 'permission',
              title: L('权限', 'Permissions'),
              options: permissionOptions(engine, record.permissionMode),
              value: record.permissionMode,
              onPick: v => {
                const to = v as PermissionMode
                if (
                  widens(record.permissionMode, to) &&
                  !confirm(
                    L(
                      '放宽权限：AI 改文件时不再先问你。确定吗？',
                      'Loosen permissions: the AI will edit files without asking you first. Continue?',
                    ),
                  )
                )
                  return
                void apply({ permissionMode: to })
              },
            },
            {
              key: 'model',
              title: custom
                ? L('模型（自定义接口的，在电脑上改）', 'Model (custom endpoint, change it on the computer)')
                : catalog.models === null && !catalog.unsupported
                  ? L('模型（正在取）', 'Model (loading)')
                  : L('模型', 'Model'),
              options: custom
                ? [{ value: record.model ?? '', label: record.model ? modelLabel(record.model) : L('默认', 'Default') }]
                : modelOptions(catalog.models, record.model),
              value: record.model ?? '',
              onPick: v => {
                // 新模型不支持现在的强度：一起退回默认，免得留下一个新模型不认的强度
                const next = catalog.models?.find(m => m.id === v)
                const drop = !!record.effort && !!next?.efforts.length && !next.efforts.includes(record.effort)
                void apply({ model: v || null, ...(drop ? { effort: null } : {}) })
              },
            },
            {
              key: 'effort',
              title: L('推理强度', 'Reasoning effort'),
              options: effortOptions(engine, model, record.effort),
              value: record.effort ?? '',
              segmented: true,
              onPick: v => void apply({ effort: (v || null) as Effort | null }),
            },
          ]}
          toggles={[
            ...(caps?.fast
              ? [
                  {
                    key: 'fast',
                    label: L('快速模式', 'Fast mode'),
                    icon: <Zap size={14} fill="currentColor" className="text-warn" />,
                    hint: fast.hint,
                    warn: fast.warn,
                    // 开不了时开关变灰；已经开着的照样能关
                    disabled: !fast.available && !record.fast,
                    value: record.fast,
                    onChange: (v: boolean) => {
                      if (v && !confirm(fastConfirm())) return
                      void apply({ fast: v })
                    },
                  },
                ]
              : []),
            ...(caps?.thinkingSummaries
              ? [
                  {
                    key: 'thinking',
                    label: L('显示思考摘要', 'Show thinking summaries'),
                    value: record.thinkingSummaries,
                    onChange: (v: boolean) => void apply({ thinkingSummaries: v }),
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  )
}
