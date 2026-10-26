// 新对话页（iOS 样子，docs/mobile-remote.md §26）：居中的问候下面两颗胶囊——项目、引擎，点开各自的面板选；
// 底部是和会话页一样的浮起输入框卡片（写第一句话、可以带图片），「+」右边的胶囊是模式，右边圆键开始。没有快捷建议。
// 引擎默认用电脑上设的那个（docs/mobile-remote.md §17 第 7 项）；
// 权限模式、模型、强度、快速模式默认用电脑上的设置，也可以在「模式」里先选好（C2，§21.5；完全放行只能在电脑上开；
// 快速模式 §25，打开确认一次）。线路总是用电脑上的。
import { useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, Folder } from 'lucide-react'
import {
  ENGINES,
  ENGINE_ORDER,
  type Effort,
  type EngineId,
  type PermissionMode,
  type SessionRecord,
} from '@pixelsky/protocol'
import type { Pairing } from '@/connection'
import { useCatalog, useDefaultEngine, useDesktop } from '@/data/hooks'
import {
  effortOptions,
  fastConfirm,
  fastDefaultHint,
  modeChip,
  modelOptions,
  permissionOptions,
  widens,
} from '@/data/mode'
import { imageDataUrl, usePendingImages } from '@/data/images'
import { attemptFor, sendKey, type SendAttempt } from '@/data/retry'
import { L } from '@/i18n'
import { Empty, FINE_POINTER, Screen, Segmented, Spinner, cn, useMedia } from '@/ui'
import { AttachButton, AttachmentStrip } from '@/ui/images'
import { ModeSheet } from '@/ui/ModeSheet'
import { Sheet } from '@/ui/sheet'

/** 胶囊（和会话页输入框里的同款）：项目、引擎、模式 */
const pill =
  'inline-flex h-9 min-w-0 items-center gap-1.5 rounded-full border border-line-subtle bg-surface px-3 text-meta text-fg active:bg-hover'

/** 新会话的模式；null 都是「用电脑上的设置」 */
interface Settings {
  permissionMode: PermissionMode | null
  model: string | null
  effort: Effort | null
  fast: boolean | null
}
const DESKTOP: Settings = { permissionMode: null, model: null, effort: null, fast: null }

export function NewTask({
  pairing,
  initialProject,
  initialText = '',
  onBack,
  onCreated,
}: {
  pairing: Pairing
  /** 在哪个项目里新建（抽屉里点的项目、当前项目） */
  initialProject?: string | null
  /** 输入框里先放好的（任务「交给 AI」） */
  initialText?: string
  onBack(): void
  onCreated(sessionId: string): void
}) {
  const { link, state, projects, loaded } = useDesktop(pairing.deviceId)
  const defaultEngine = useDefaultEngine(pairing.deviceId)
  const [projectId, setProjectId] = useState<string | null>(initialProject ?? null)
  // 没选过就跟电脑上的默认引擎；电脑版太旧拿不到时用 Claude
  const [picked, setPicked] = useState<EngineId | null>(null)
  const engine = picked ?? defaultEngine ?? 'claude'
  // 模型和强度跟引擎走：换了引擎（包括电脑上的默认引擎晚一点才取到）就回到电脑上的设置；
  // 权限模式留着（新引擎也支持这一档时），免得先选好的「只规划」被悄悄换成电脑上更宽的设置
  const [settings, setSettings] = useState<{ engine: EngineId; value: Settings }>({ engine, value: DESKTOP })
  const kept = settings.value.permissionMode
  const mode =
    settings.engine === engine
      ? settings.value
      : { ...DESKTOP, permissionMode: kept && ENGINES[engine]?.caps.permissionModes.includes(kept) ? kept : null }
  const setMode = (patch: Partial<Settings>) => setSettings({ engine, value: { ...mode, ...patch } })
  const [modeOpen, setModeOpen] = useState(false)
  const [picker, setPicker] = useState<'project' | 'engine' | null>(null)
  const enterSends = useMedia(FINE_POINTER)
  const [text, setText] = useState(initialText)
  const images = usePendingImages()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = (projects.some(p => p.id === projectId) ? projectId : null) ?? projects[0]?.id ?? null
  const hasContent = !!text.trim() || images.images.length > 0

  // 上次建好了会话、但消息没发成功：重试时不再新建会话，消息沿用同一个 ID（data/retry.ts）
  const created = useRef<{ key: string; sessionId: string } | null>(null)
  const attempt = useRef<SendAttempt | null>(null)
  const create = async () => {
    if (!link || !chosen || !hasContent) return
    setBusy(true)
    setError(null)
    const value = text.trim()
    const ids = images.images.map(i => i.id)
    const picks = Object.fromEntries(Object.entries(mode).filter(([, v]) => v !== null))
    const target = JSON.stringify([chosen, engine, picks])
    try {
      if (created.current?.key !== target) {
        const record = await link.call<SessionRecord>('engine:createSession', { projectId: chosen, engine, ...picks })
        created.current = { key: target, sessionId: record.id }
      }
      const sessionId = created.current.sessionId
      const current = attemptFor(attempt.current, sendKey(sessionId, value, ids), () => crypto.randomUUID())
      attempt.current = current
      await link.call('engine:send', sessionId, {
        text: value,
        clientMessageId: current.id,
        ...(images.images.length ? { attachments: images.images } : {}),
      })
      created.current = null
      attempt.current = null
      onCreated(sessionId)
    } catch (e) {
      const code = (e as Error).message
      setError(
        code === 'MOBILE_BAD_ARGUMENT'
          ? L(
              '电脑不接受这个模式，换一个或用电脑上的设置。',
              "The computer didn't accept this mode. Pick another or use the computer's settings.",
            )
          : code,
      )
      setBusy(false)
    }
  }

  const ready = state === 'ready' && !!chosen && hasContent && !busy && !images.busy
  const project = projects.find(p => p.id === chosen)
  const shownError = error ?? images.error

  return (
    <Screen
      title={L('新对话', 'New conversation')}
      subtitle={L(`在 ${pairing.desktopName} 上`, `On ${pairing.desktopName}`)}
      onBack={onBack}
      footer={
        <div className="mx-auto w-full max-w-3xl px-3 pt-1 pb-3">
          {shownError && <p className="px-1 pb-1.5 text-meta text-danger">{shownError}</p>}
          <div className="rounded-[22px] border border-line-composer bg-surface px-2.5 pt-2.5 pb-2 shadow-composer focus-within:border-line-composer-focus">
            <AttachmentStrip
              images={images.images.map(i => ({ id: i.id, src: imageDataUrl(i) }))}
              busy={images.busy}
              onRemove={images.remove}
            />
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (!enterSends || e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
                e.preventDefault()
                if (ready) void create()
              }}
              rows={1}
              autoFocus
              data-key-target="composer"
              enterKeyHint="send"
              placeholder={L(
                '例如：把登录页的按钮改成圆角，并补上单元测试',
                'e.g. Round the buttons on the login page and add unit tests',
              )}
              className="field-sizing-content block max-h-40 min-h-7 w-full resize-none bg-transparent px-1 text-prose text-fg outline-none placeholder:text-fg-faint"
            />
            <div className="mt-2 flex items-center gap-2">
              <AttachButton disabled={busy} onFiles={files => void images.add(files)} />
              {/* 模式（权限、模型、强度、速度）：一颗胶囊，窄屏收窄、文字截断 */}
              <div className="flex min-w-0 flex-1 items-center">
                <button type="button" onClick={() => setModeOpen(true)} className={cn(pill, 'shrink')}>
                  <span className="truncate">{modeText(mode)}</span>
                </button>
              </div>
              <button
                type="button"
                aria-label={busy ? L('正在创建…', 'Creating…') : L('开始', 'Start')}
                disabled={!ready}
                onClick={() => void create()}
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full transition-colors',
                  ready ? 'bg-primary text-primary-fg' : 'bg-subtle text-fg-faint',
                )}
              >
                {busy ? <Spinner size={16} /> : <ArrowUp size={17} strokeWidth={2.25} />}
              </button>
            </div>
          </div>
        </div>
      }
    >
      {loaded && projects.length === 0 ? (
        <Empty
          icon={Folder}
          title={L('电脑上还没有项目', 'No projects on the computer yet')}
          body={L(
            '先在电脑上的像素星空里添加一个项目文件夹。',
            'Add a project folder in PixelSky on the computer first.',
          )}
        />
      ) : (
        <div className="flex min-h-full flex-col items-center justify-center gap-1.5 px-6 pb-10 text-center">
          <h2 className="text-section font-semibold">{L('想让 AI 做点什么？', 'What should the AI do?')}</h2>
          <p className="text-meta text-fg-faint">{L('会在电脑上的项目里运行', 'Runs in a project on your computer')}</p>
          <div className="mt-3 flex max-w-full flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={() => setPicker('project')} className={cn(pill, 'max-w-full')}>
              <Folder size={15} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
              <span className="truncate">{project?.name ?? L('选项目', 'Project')}</span>
              <ChevronDown size={14} className="shrink-0 text-fg-faint" />
            </button>
            <button type="button" onClick={() => setPicker('engine')} className={cn(pill, 'max-w-full')}>
              <span className="truncate">{ENGINES[engine]?.name ?? engine}</span>
              <ChevronDown size={14} className="shrink-0 text-fg-faint" />
            </button>
          </div>
        </div>
      )}
      {picker === 'project' && (
        <Sheet title={L('项目', 'Project')} onClose={() => setPicker(null)}>
          {projects.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setProjectId(p.id)
                setPicker(null)
              }}
              className={cn(
                'flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left active:bg-hover',
                i > 0 && 'border-t border-line',
              )}
            >
              <Folder size={20} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ui">{p.name}</span>
                <span className="truncate font-mono text-label text-fg-faint" dir="rtl">
                  {p.path}
                </span>
              </span>
              {chosen === p.id && <Check size={20} className="shrink-0 text-accent-fg" />}
            </button>
          ))}
        </Sheet>
      )}
      {picker === 'engine' && (
        <Sheet title={L('引擎', 'Engine')} onClose={() => setPicker(null)}>
          <div className="px-5 pt-1 pb-4">
            <Segmented<EngineId>
              options={ENGINE_ORDER.map(id => ({ value: id, label: ENGINES[id].name }))}
              value={engine}
              onChange={id => {
                setPicked(id)
                setPicker(null)
              }}
            />
            {defaultEngine && !picked && (
              <p className="mt-2 px-1 text-label text-fg-faint">
                {L('默认用电脑上设的引擎。', 'Defaults to the engine set on the computer.')}
              </p>
            )}
          </div>
        </Sheet>
      )}
      {modeOpen && (
        <NewMode
          deviceId={pairing.deviceId}
          engine={engine}
          mode={mode}
          onChange={setMode}
          onClose={() => setModeOpen(false)}
        />
      )}
    </Screen>
  )
}

/** 「每步问我 · Opus 4.1 · 高」；没选的项不显示，全没选是「用电脑上的设置」 */
function modeText(mode: Settings): string {
  const chip = modeChip({ permissionMode: mode.permissionMode ?? 'ask', model: mode.model, effort: mode.effort })
  const speed = mode.fast === null ? null : mode.fast ? L('快速', 'Fast') : L('普通速度', 'Normal speed')
  const parts = [mode.permissionMode && chip.permission, chip.model, chip.effort, speed].filter(Boolean)
  return parts.length ? parts.join(' · ') : L('用电脑上的设置', "Computer's settings")
}

function NewMode({
  deviceId,
  engine,
  mode,
  onChange,
  onClose,
}: {
  deviceId: string
  engine: EngineId
  mode: Settings
  onChange(patch: Partial<Settings>): void
  onClose(): void
}) {
  const catalog = useCatalog(deviceId, engine)
  const model = catalog.models?.find(m => m.id === mode.model)
  return (
    <ModeSheet
      title={L('新会话的模式', 'Mode for the new conversation')}
      readOnly={catalog.unsupported}
      error={
        catalog.unsupported
          ? L(
              '电脑上的像素星空版本较旧，新会话用电脑上的设置。',
              "The PixelSky app on your computer is out of date. The new conversation will use the computer's settings.",
            )
          : null
      }
      note={L('没选的项用电脑上的设置。', "Anything not selected uses the computer's settings.")}
      onClose={onClose}
      groups={[
        {
          key: 'permission',
          title: L('权限', 'Permissions'),
          options: permissionOptions(engine, null),
          value: mode.permissionMode ?? '',
          onPick: v => {
            const to = (v || null) as PermissionMode | null
            if (
              to &&
              widens(null, to) &&
              !confirm(
                L(
                  '放宽权限：AI 改文件时不再先问你。确定吗？',
                  "Loosen permissions? The AI won't ask before editing files.",
                ),
              )
            )
              return
            onChange({ permissionMode: to })
          },
        },
        {
          key: 'model',
          title:
            catalog.models === null && !catalog.unsupported
              ? L('模型（正在取）', 'Model (loading)')
              : L('模型', 'Model'),
          options: modelOptions(catalog.models, mode.model),
          value: mode.model ?? '',
          // 换了模型：强度可能不在新模型的范围里，回到默认
          onPick: v => onChange({ model: v || null, effort: null }),
        },
        {
          key: 'effort',
          title: L('推理强度', 'Reasoning effort'),
          options: effortOptions(engine, model, mode.effort),
          value: mode.effort ?? '',
          onPick: v => onChange({ effort: (v || null) as Effort | null }),
        },
        ...(ENGINES[engine]?.caps.fast
          ? [
              {
                key: 'fast',
                title: L('速度', 'Speed'),
                options: [
                  { value: '', label: L('电脑上的设置', "Computer's settings") },
                  { value: 'off', label: L('普通', 'Normal') },
                  { value: 'on', label: L('快速模式', 'Fast mode'), hint: fastDefaultHint() },
                ],
                value: mode.fast === null ? '' : mode.fast ? 'on' : 'off',
                onPick: (v: string) => {
                  if (v === 'on' && !confirm(fastConfirm())) return
                  onChange({ fast: v === '' ? null : v === 'on' })
                },
              },
            ]
          : []),
      ]}
    />
  )
}
