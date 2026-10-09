import { translateMessage } from '../../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
// 设置 › 本机引擎 › 一个引擎的详情（docs/ui/engine-settings-redesign.md §3.2、§5，参考 Mirasim 设置 › 智能体 › Claude Code）：
// 头部（版本、路径、重新检测、检查更新、设为默认）→ 新会话默认值 → 对话 → 上下文 → 高级。
// 改了立刻保存。除「新会话默认值」外，对已开始的会话也生效：下一条消息开始前用新设置重启引擎进程并接上原对话。
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, CircleCheck, Download, RefreshCw } from 'lucide-react'
import {
  AUTO_COMPACT_PCTS,
  type Effort,
  type EngineCatalog,
  type EngineConfigPatch,
  type EngineLocalConfig,
  type EngineUpdateResult,
  type PermissionMode,
} from '@pixelsky/protocol'
import { Button, EngineIcon, Select, cn } from '@/ui'
import { Switch } from '@/features/session/ComposerMenus'
import { platformModels, usePlatform } from '@/features/account/platform'
import { EFFORT_LABEL, PERMISSION_INFO, bridge, isLive, redetectEngines } from '@/features/engine'
import { envLines, parseEnvLines } from './envLines'
import { DefaultBadge, ENGINE_INTRO, ENGINE_STATUS, FIELD } from './parts'
import { demo, isDemo } from '@/data/demo'
import type { EngineLite } from '@/data/types'

export function EngineDetail({
  engine: e,
  config,
  isDefault,
  onSave,
  onSetDefault,
  onBack,
  onOpenModels,
}: {
  engine: EngineLite
  config: EngineLocalConfig
  isDefault: boolean
  onSave: (patch: EngineConfigPatch) => Promise<void>
  onSetDefault: () => Promise<void>
  onBack: () => void
  onOpenModels?: () => void
}) {
  useI18n()
  const [error, setError] = useState<string | null>(null)
  const run = (patch: EngineConfigPatch): void => {
    setError(null)
    onSave(patch).catch((err: unknown) => setError((err as Error).message))
  }
  const d = config.defaults

  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 mb-4 inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-meta text-fg-muted hover:text-fg"
      >
        <ChevronLeft size={14} />
        {tr('settings.engines.EngineDetail.allEngines')}{' '}
      </button>

      <Header engine={e} isDefault={isDefault} onSetDefault={onSetDefault} />
      <p className="mt-4 mb-2 rounded-lg bg-subtle px-3 py-2 text-meta text-fg-muted">
        {tr('settings.engines.EngineDetail.changesTakeEffectImmediately')} {e.name}
        {tr('settings.engines.EngineDetail.andResumesConversation')}{' '}
      </p>

      {error && (
        <p role="alert" className="mt-3 text-meta text-danger">
          {translateMessage(error)}
        </p>
      )}

      <Group
        title={tr('settings.engines.EngineDetail.newConversationDefaults')}
        note={tr('settings.engines.EngineDetail.appliesToNewConversations')}
      >
        <Row
          title={tr('session.Composer.reasoningEffort')}
          description={tr('settings.engines.EngineDetail.higherEffortSpendsMore')}
          control={
            <Select
              label={tr('settings.engines.EngineDetail.defaultReasoningEffort')}
              value={d.effort ?? ''}
              onChange={v => run({ defaults: { effort: (v || null) as Effort | null } })}
              options={[
                { value: '', label: tr('settings.engines.EngineDetail.default', { p0: e.name }) },
                ...e.caps.efforts.map(x => ({ value: x, label: EFFORT_LABEL[x] })),
              ]}
            />
          }
        />
        <Row
          title={tr('settings.engines.EngineDetail.permissions')}
          description={PERMISSION_INFO[d.permissionMode].hint}
          control={
            <Select
              label={tr('settings.engines.EngineDetail.defaultPermissions')}
              value={d.permissionMode}
              onChange={v => run({ defaults: { permissionMode: v as PermissionMode } })}
              options={e.caps.permissionModes.map(m => ({ value: m, label: PERMISSION_INFO[m].label }))}
            />
          }
        />
        <Row
          title={tr('session.ModelSourceMenu.model')}
          description={tr('settings.engines.EngineDetail.defaultModelsForPlatform')}
          control={
            onOpenModels && (
              <button
                type="button"
                onClick={onOpenModels}
                className="shrink-0 text-meta text-accent-fg hover:underline"
              >
                {tr('settings.engines.EngineDetail.manageModels')}{' '}
              </button>
            )
          }
        />
        {e.caps.fast && (
          <Row
            title={tr('session.ComposerMenus.fastMode')}
            description={tr('settings.engines.EngineDetail.fasterRepliesWithHigher')}
            control={
              <Switch
                checked={d.fast}
                label={tr('settings.engines.EngineDetail.enableFastModeBy')}
                onChange={on => run({ defaults: { fast: on } })}
              />
            }
          />
        )}
        {e.caps.ultracode && (
          <Row
            title="Ultracode"
            description={tr('settings.engines.EngineDetail.orchestrateMultipleSubagentsFor')}
            control={
              <Switch
                checked={d.ultracode}
                tone="ultracode"
                label={tr('settings.engines.EngineDetail.enableUltracodeByDefault')}
                onChange={on => run({ defaults: { ultracode: on } })}
              />
            }
          />
        )}
        {e.caps.thinkingSummaries && (
          <Row
            title={tr('settings.engines.EngineDetail.showThinking')}
            description={tr('settings.engines.EngineDetail.onRequestAndShow')}
            control={
              <Switch
                checked={d.thinkingSummaries}
                label={tr('settings.engines.EngineDetail.showThinkingByDefault')}
                onChange={on => run({ defaults: { thinkingSummaries: on } })}
              />
            }
          />
        )}
      </Group>

      {e.caps.launchSettings && (
        <Group title={tr('settings.engines.EngineDetail.conversation')}>
          <OutputStyleRow engine={e} value={config.outputStyle} onChange={outputStyle => run({ outputStyle })} />
          <Row
            title={tr('settings.engines.EngineDetail.allowQuestionsDuringTasks')}
            description={tr('settings.engines.EngineDetail.onPauseToAsk')}
            control={
              <Switch
                checked={config.askQuestions}
                label={tr('settings.engines.EngineDetail.allowQuestionsDuringTasks')}
                onChange={on => run({ askQuestions: on })}
              />
            }
          />
        </Group>
      )}

      {!e.caps.launchSettings && <p className="mt-4 text-meta text-fg-muted">{tr('codex.nativeSettings')}</p>}
      {e.caps.launchSettings && (
        <Group title={tr('session.ContextWindowButton.context2')}>
          <Row
            title={tr('settings.engines.EngineDetail.autocompactThreshold')}
            description={tr('settings.engines.EngineDetail.automaticallyCompactAtThis')}
            control={
              <Select
                label={tr('settings.engines.EngineDetail.autocompactThreshold')}
                value={config.autoCompactPct === null ? '' : String(config.autoCompactPct)}
                onChange={v => run({ autoCompactPct: v ? Number(v) : null })}
                options={[
                  {
                    value: '',
                    get label() {
                      return tr('settings.engines.EngineDetail.defaultBuiltInThreshold')
                    },
                  },
                  ...AUTO_COMPACT_PCTS.map(p => ({
                    value: String(p),
                    label: tr('settings.engines.EngineDetail.atUsage', { p0: p }),
                  })),
                ]}
              />
            }
          />
          <CompactModelRow engine={e} value={config.compactModel} onChange={compactModel => run({ compactModel })} />
        </Group>
      )}

      <Group title={tr('settings.engines.EngineDetail.advanced')}>
        <Row
          title={tr('settings.engines.EngineDetail.showInEngineMenu')}
          description={tr('settings.engines.EngineDetail.hideThisEngineFrom')}
          hint={isDefault ? tr('settings.engines.EngineDetail.defaultEngineCannotBe') : undefined}
          control={
            <Switch
              checked={!config.hidden}
              disabled={isDefault}
              label={tr('settings.engines.EngineDetail.showInEngineMenu')}
              onChange={on => run({ hidden: !on })}
            />
          }
        />
        <LaunchRows engine={e} config={config} onSave={onSave} />
      </Group>
    </section>
  )
}

/** 头部：图标、名字、默认角标、版本 · 路径、介绍；右侧设为默认、重新检测、检查更新 */
function Header({
  engine: e,
  isDefault,
  onSetDefault,
}: {
  engine: EngineLite
  isDefault: boolean
  onSetDefault: () => Promise<void>
}) {
  useI18n()
  const [updating, setUpdating] = useState(false)
  const [result, setResult] = useState<(EngineUpdateResult & { before: string | null }) | { error: string } | null>(
    null,
  )
  const [redetecting, setRedetecting] = useState(false)

  const update = async (): Promise<void> => {
    if (!bridge) {
      setResult({
        get error() {
          return tr('settings.engines.EngineDetail.demoModeCannotUpdate')
        },
      })
      return
    }
    setUpdating(true)
    setResult(null)
    const before = e.version
    try {
      setResult({ ...(await bridge.updateEngine(e.id)), before })
    } catch (err) {
      setResult({ error: (err as Error).message })
    } finally {
      setUpdating(false)
    }
  }
  const redetect = async (): Promise<void> => {
    if (!isLive) return
    setRedetecting(true)
    try {
      await redetectEngines()
    } finally {
      setRedetecting(false)
    }
  }

  const ready = e.status === 'ready'
  const canUpdate = e.caps.selfUpdate && e.status !== 'missing' && e.status !== 'unsupported'
  return (
    <div>
      <div data-setting-title={e.name} className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-subtle">
          <EngineIcon engine={e.id} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-section font-semibold text-fg">{e.name}</h3>
            {isDefault && <DefaultBadge />}
            {ready ? (
              <span className="inline-flex items-center gap-1 text-meta text-success">
                <CircleCheck size={12} />
                {tr('settings.editor.EditorSection.available')}{' '}
              </span>
            ) : (
              <span className="text-meta text-warn">{ENGINE_STATUS[e.status] ?? e.status}</span>
            )}
          </div>
          <div className="selectable mt-0.5 truncate font-mono text-meta text-fg-muted" title={e.path ?? undefined}>
            {[e.version ? `v${e.version}` : null, e.path].filter(Boolean).join(' · ') ||
              tr('settings.engines.EngineDetail.executableNotDetected')}
          </div>
          <p className="mt-1 text-meta text-fg-secondary">{ENGINE_INTRO[e.id]}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!isDefault && ready && (
            <Button variant="outline" className="h-8 px-3 text-meta" onClick={() => void onSetDefault()}>
              {tr('session.ModelSourceMenu.setAsDefault')}{' '}
            </Button>
          )}
          <Button
            variant="outline"
            icon={RefreshCw}
            className="h-8 px-3 text-meta"
            disabled={redetecting || !isLive}
            onClick={() => void redetect()}
          >
            {redetecting ? tr('settings.engines.EngineDetail.detecting') : tr('session.SourceHintBar.detectAgain')}
          </Button>
          {canUpdate && (
            <span data-setting-title="检查更新" className="rounded-md">
              <Button
                variant="outline"
                icon={Download}
                className="h-8 px-3 text-meta"
                disabled={updating}
                onClick={() => void update()}
              >
                {updating
                  ? tr('settings.engines.EngineDetail.checkingForUpdates')
                  : tr('settings.AboutSection.checkForUpdates')}
              </Button>
            </span>
          )}
        </div>
      </div>
      {!ready && e.message && (
        <p className="mt-3 rounded-lg border border-line px-3 py-2 text-meta text-warn">
          {translateMessage(e.message)}
        </p>
      )}
      {updating && (
        <p className="mt-3 text-meta text-fg-muted">{tr('settings.engines.EngineDetail.runningClaudeUpdateThis')}</p>
      )}
      {result && <UpdateResult result={result} />}
    </div>
  )
}

function UpdateResult({ result }: { result: (EngineUpdateResult & { before: string | null }) | { error: string } }) {
  useI18n()
  if ('error' in result) {
    return (
      <p role="alert" className="mt-3 rounded-lg border border-line px-3 py-2 text-meta text-danger">
        {translateMessage(result.error)}
      </p>
    )
  }
  const changed = result.version && result.before && result.version !== result.before
  const title = !result.ok
    ? tr('settings.engines.EngineDetail.updateDidNotComplete')
    : changed
      ? tr('settings.engines.EngineDetail.updatedToPreviously', { p0: result.version, p1: result.before })
      : tr('settings.engines.EngineDetail.alreadyUpToDate', { p0: result.version ? `（${result.version}）` : '' })
  return (
    <div role="status" className="mt-3 rounded-lg border border-line px-3 py-2">
      <p className={cn('text-meta', result.ok ? 'text-fg' : 'text-danger')}>{title}</p>
      {result.output && (
        <pre className="selectable mt-1.5 overflow-x-auto font-mono text-label whitespace-pre-wrap text-fg-muted">
          {result.output}
        </pre>
      )}
      {result.ok && changed && (
        <p className="mt-1.5 text-label text-fg-faint">
          {tr('settings.engines.EngineDetail.newConversationsUseUpdated')}
        </p>
      )}
    </div>
  )
}

/** 输出风格：列表从引擎的初始化握手里读（不发消息），读不到时只显示「跟随」和已经选的那个 */
function OutputStyleRow({
  engine: e,
  value,
  onChange,
}: {
  engine: EngineLite
  value: string | null
  onChange: (v: string | null) => void
}) {
  useI18n()
  const [catalog, setCatalog] = useState<EngineCatalog | null>(isDemo ? demo().engines.catalog : null)
  const [loading, setLoading] = useState(isLive)
  useEffect(() => {
    if (!bridge) return
    let alive = true
    void bridge
      .catalog(e.id)
      .then(c => alive && setCatalog(c))
      .catch(() => alive && setCatalog({ outputStyles: [], currentOutputStyle: null }))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [e.id])

  const styles = catalog?.outputStyles ?? []
  const follow = catalog?.currentOutputStyle
    ? tr('settings.engines.EngineDetail.useEngineSettings', { p0: catalog.currentOutputStyle })
    : tr('settings.engines.EngineDetail.useEngineSettings2')
  return (
    <Row
      title={tr('settings.engines.EngineDetail.outputStyle')}
      description={tr('settings.engines.EngineDetail.changesWritingStyleNot', { p0: e.name })}
      hint={
        !loading && styles.length === 0 ? tr('settings.engines.EngineDetail.couldNotLoadS', { p0: e.name }) : undefined
      }
      control={
        <Select
          label={tr('settings.engines.EngineDetail.outputStyle')}
          disabled={loading}
          value={value ?? ''}
          onChange={v => onChange(v || null)}
          options={[
            { value: '', label: loading ? tr('settings.engines.EngineDetail.loading') : follow },
            ...(value && !styles.includes(value)
              ? [{ value, label: tr('settings.engines.EngineDetail.notFound', { p0: value }) }]
              : []),
            ...styles.map(x => ({ value: x, label: x })),
          ]}
        />
      }
    />
  )
}

/** 压缩上下文用的模型（plan-search-panes-compact.md §3）：只对平台会话生效 */
function CompactModelRow({
  engine: e,
  value,
  onChange,
}: {
  engine: EngineLite
  value: string | null
  onChange: (v: string | null) => void
}) {
  useI18n()
  const platform = usePlatform()
  const models = platformModels(platform.groups)
  return (
    <Row
      title={tr('settings.engines.EngineDetail.contextCompactionModel')}
      description={tr('settings.engines.EngineDetail.platformConversationsOnlyUse', { p0: e.name })}
      control={
        <Select
          label={tr('settings.engines.EngineDetail.contextCompactionModel2', { p0: e.name })}
          mono
          value={value ?? ''}
          onChange={v => onChange(v || null)}
          options={[
            {
              value: '',
              get label() {
                return tr('settings.engines.EngineDetail.useConversationModel')
              },
            },
            ...(value && !models.includes(value) ? [{ value, label: value }] : []),
            ...models.map(m => ({ value: m, label: m })),
          ]}
        />
      }
    />
  )
}

/** 启动方式：可执行文件路径（失焦 / 回车保存）、追加的环境变量（失焦保存） */
function LaunchRows({
  engine: e,
  config,
  onSave,
}: {
  engine: EngineLite
  config: EngineLocalConfig
  onSave: (patch: EngineConfigPatch) => Promise<void>
}) {
  useI18n()
  const [path, setPath] = useState(config.path ?? '')
  const [env, setEnv] = useState(envLines(config.env))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setPath(config.path ?? ''), [config.path])
  useEffect(() => setEnv(envLines(config.env)), [config.env])

  const save = (patch: EngineConfigPatch): void => {
    setError(null)
    onSave(patch).catch((err: unknown) => setError((err as Error).message))
  }
  const savePath = (): void => {
    if (path.trim() !== (config.path ?? '')) save({ path: path.trim() || null })
  }
  const saveEnv = (): void => {
    const { env: parsed, bad } = parseEnvLines(env)
    if (bad) {
      setError(tr('settings.engines.EngineDetail.thisLineIsNot', { p0: bad }))
      return
    }
    if (envLines(parsed) !== envLines(config.env)) save({ env: parsed })
  }

  return (
    <>
      <Row
        title={tr('settings.engines.EngineDetail.executablePath')}
        description={tr('settings.engines.EngineDetail.overrideDetectedExecutableLeave')}
      >
        <input
          value={path}
          onChange={ev => setPath(ev.target.value)}
          onBlur={savePath}
          onKeyDown={ev => ev.key === 'Enter' && savePath()}
          placeholder={e.path ?? tr('settings.engines.EngineDetail.executablePath2', { p0: e.id })}
          aria-label={tr('settings.engines.EngineDetail.executablePath')}
          className={cn(FIELD, 'font-mono text-meta')}
          spellCheck={false}
        />
      </Row>
      <Row
        title={tr('settings.engines.EngineDetail.environmentVariables')}
        description={tr('settings.engines.EngineDetail.oneKeyValuePer')}
      >
        <textarea
          value={env}
          onChange={ev => setEnv(ev.target.value)}
          onBlur={saveEnv}
          rows={4}
          placeholder="HTTPS_PROXY=http://127.0.0.1:7890"
          aria-label={tr('settings.engines.EngineDetail.environmentVariables')}
          className={cn(FIELD, 'resize-y font-mono text-meta')}
          spellCheck={false}
        />
      </Row>
      {error && (
        <p role="alert" className="-mt-2 text-meta text-danger">
          {translateMessage(error)}
        </p>
      )}
    </>
  )
}

/** 一组设置：小标题 + 带边框的卡片（参考 Mirasim 设置 › 智能体） */
function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  useI18n()
  return (
    <div className="mt-7">
      <h4 data-setting-title={title} className="mb-2 rounded-md text-label font-medium text-fg-muted">
        {title}
      </h4>
      {note && <p className="-mt-1 mb-2 text-meta text-fg-faint">{note}</p>}
      <div className="rounded-xl border border-line bg-surface/60 px-4">{children}</div>
    </div>
  )
}

/** 卡片里的一行：左边标题和说明，右边控件；有 children 时控件放在下面（输入框） */
function Row({
  title,
  description,
  hint,
  control,
  children,
}: {
  title: string
  description: string
  hint?: string
  control?: ReactNode
  children?: ReactNode
}) {
  useI18n()
  return (
    <div
      data-setting-title={title}
      className="-mx-2 rounded-md border-t border-line-subtle px-2 py-3.5 first:border-t-0"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-ui font-medium text-fg">{title}</div>
          <p className="mt-0.5 text-meta text-fg-muted">{description}</p>
          {hint && <p className="mt-1 text-meta text-fg-faint">{hint}</p>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children && <div className="mt-2.5">{children}</div>}
    </div>
  )
}
