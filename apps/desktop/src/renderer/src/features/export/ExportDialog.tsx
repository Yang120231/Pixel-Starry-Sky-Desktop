// 导出对话框（docs/ui/conversation-export.md）：范围、格式、包含项、预览；导出前扫描疑似密钥，默认打码
import { useMemo, useState, type ReactNode } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { isDemo } from '@/data'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, type TranslationKey } from '@/i18n/core'
import { useSession } from '@/features/engine'
import { clipboardWrite } from '@/features/session/contextMenu/clipboard'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { Segmented, cn, useToast } from '@/ui'
import {
  EXPORT_FORMATS,
  buildDoc,
  exportBaseName,
  redactDoc,
  renderDoc,
  scanDoc,
  selectDoc,
  sizeLabel,
  summarize,
  turnOf,
  type ExportFormat,
  type ExportHit,
} from './model'
import { closeExport, loadPrefs, savePrefs, useExportRequest, type ExportRequest } from './store'

const MIME: Record<ExportFormat, string> = {
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  json: 'application/json;charset=utf-8',
}
const FORMAT_LABEL: Record<ExportFormat, string> = { md: 'Markdown', html: 'HTML', json: 'JSON' }
/** 警告块里最多列几行，其余折成「还有 N 处」 */
const HITS_SHOWN = 6

/** 每个窗口只有一个导出对话框：命令面板、右键菜单往 store 里放请求，这里接住显示（App 根上挂一次） */
export function ExportHost() {
  const request = useExportRequest()
  return request ? <ExportDialog key={request.key} request={request} /> : null
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-14 shrink-0 pt-1 text-meta text-fg-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

const NUMBER =
  'h-7 w-14 rounded-md border border-line bg-surface px-2 text-center font-mono text-list text-fg outline-none focus:border-accent-line'

function hitKindLabel(hit: ExportHit): string {
  switch (hit.kind) {
    case 'sk':
      return 'sk-'
    case 'github':
      return hit.snippet.startsWith('github_pat_') ? 'github_pat' : hit.snippet.slice(0, 4)
    case 'aws':
      return 'AKIA'
    case 'private-key':
      return tr('export.kind.private')
    case 'assignment':
      return 'KEY='
  }
}

export function ExportDialog({ request }: { request: ExportRequest }) {
  useI18n()
  const toast = useToast()
  const snapshot = useSession(request.sessionId)
  const [at] = useState(() => Date.now())
  const doc = useMemo(() => (snapshot ? buildDoc(snapshot.items, snapshot.record, at) : null), [snapshot, at])
  const total = doc?.total ?? 0

  const [prefs] = useState(loadPrefs)
  const [format, setFormat] = useState<ExportFormat>(prefs.format)
  const [tools, setTools] = useState(prefs.tools)
  const [thinking, setThinking] = useState(prefs.thinking)
  // 从消息右键菜单打开：范围预选那条消息所在的一轮
  const [preset] = useState(() => (doc && request.itemId ? turnOf(doc, request.itemId) : null))
  const [scope, setScope] = useState<'all' | 'range'>(preset ? 'range' : 'all')
  const [fromText, setFromText] = useState(String(preset ?? 1))
  const [toText, setToText] = useState(String(preset ?? Math.max(total, 1)))
  const [choice, setChoice] = useState<'mask' | 'raw'>('mask')
  const [rawAsk, setRawAsk] = useState<'save' | 'copy' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clampTurn = (text: string, fallback: number): number => {
    const n = Number.parseInt(text, 10)
    return Number.isNaN(n) ? fallback : Math.min(Math.max(n, 1), Math.max(total, 1))
  }
  const a = clampTurn(fromText, 1),
    b = clampTurn(toText, total)
  const lo = scope === 'all' ? 1 : Math.min(a, b),
    hi = scope === 'all' ? total : Math.max(a, b)

  const selected = useMemo(
    () => (doc ? selectDoc(doc, { tools, thinking, from: lo, to: hi }) : null),
    [doc, tools, thinking, lo, hi],
  )
  const hits = useMemo(() => (selected ? scanDoc(selected) : []), [selected])
  const masked = choice === 'mask' && hits.length > 0
  // 选了打码就一律过 redactDoc（没命中时什么都不改）：范围外的标题里可能有密钥，文件名也用打码后的标题
  const shown = useMemo(() => (selected && choice === 'mask' ? redactDoc(selected) : selected), [selected, choice])
  const text = useMemo(
    () => (shown ? renderDoc(shown, format, masked ? hits.length : 0) : ''),
    [shown, format, masked, hits.length],
  )
  const counts = selected ? summarize(selected) : { users: 0, replies: 0, tools: 0 }
  const empty = !selected || selected.turns.every(t => t.parts.length === 0)
  const fileName = shown ? `${exportBaseName(shown)}.${format}` : ''
  const hitTurns = new Set(hits.map(h => h.turn))
  const turnCount = selected?.turns.length ?? 0

  const pickTurn = (n: number, extend: boolean): void => {
    setScope('range')
    if (extend) {
      setFromText(String(Math.min(a, n)))
      setToText(String(Math.max(b, n)))
    } else {
      setFromText(String(n))
      setToText(String(n))
    }
  }

  const view = (anchor: string | null): void => {
    closeExport()
    if (anchor)
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-search-item="${CSS.escape(anchor)}"]`)
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      )
  }

  const run = async (action: 'save' | 'copy'): Promise<void> => {
    if (!shown || busy) return
    setBusy(true)
    setError(null)
    savePrefs({ format, tools, thinking })
    try {
      if (action === 'copy') {
        await clipboardWrite(text)
        closeExport()
        toast(masked ? tr('export.copiedMasked', { m: hits.length }) : tr('export.copied'))
        return
      }
      const name = exportBaseName(shown)
      const done = masked
        ? tr('export.doneMasked', { n: turnCount, m: hits.length })
        : tr('export.done', { n: turnCount })
      const bridge = isDemo ? undefined : window.pixelsky?.conversationExport
      if (bridge) {
        const path = await bridge.save({ name, ext: format, content: text })
        if (!path) {
          setRawAsk(null) // 在保存对话框里取消：回到导出对话框
          return
        }
        closeExport()
        toast(`${done} · ${path.split(/[\\/]/).pop()}`, {
          duration: 8000,
          action: {
            label: tr('export.openFolder'),
            run: () => void window.pixelsky?.editor.revealOutside(path).catch(() => {}),
          },
        })
        return
      }
      // 演示模式没有主进程：交给浏览器下载
      const url = URL.createObjectURL(new Blob([text], { type: MIME[format] }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${name}.${format}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      closeExport()
      toast(`${done} · ${name}.${format}`)
    } catch (e) {
      setRawAsk(null)
      setError(action === 'copy' ? tr('export.copyFailed') : tr('export.failed', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }
  // 原样导出（含复制）有命中时要再确认一次
  const start = (action: 'save' | 'copy'): void => {
    if (hits.length > 0 && choice === 'raw') setRawAsk(action)
    else void run(action)
  }

  if (rawAsk)
    return (
      <ConfirmDialog
        title={tr('export.raw.title')}
        description={tr('export.raw.body', { n: hits.length })}
        confirmLabel={tr('export.raw.confirm')}
        cancelLabel={tr('export.raw.back')}
        busy={busy}
        error={error}
        warn
        onConfirm={() => void run(rawAsk)}
        onCancel={() => setRawAsk(null)}
      />
    )

  const confirmLabel =
    hits.length === 0
      ? tr('export.btn.export')
      : masked
        ? tr('export.btn.exportMasked', { n: hits.length })
        : tr('export.btn.exportRaw')

  return (
    <ConfirmDialog
      wide
      title={tr('export.title')}
      description={
        <div data-export-dialog>
          <div className="mb-2 truncate text-meta text-fg-muted">
            {tr('export.sub', { title: doc?.title ?? '', n: total })}
          </div>
          <Row label={tr('export.scope')}>
            <Segmented<'all' | 'range'>
              label={tr('export.scope')}
              value={scope}
              options={[
                { value: 'all', label: tr('export.scope.all') },
                { value: 'range', label: tr('export.scope.range') },
              ]}
              onChange={setScope}
            />
            {scope === 'range' && (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-list text-fg-secondary">
                  {tr('export.range.from')}
                  <input
                    type="number"
                    min={1}
                    max={total}
                    aria-label={tr('export.range.fromLabel')}
                    className={NUMBER}
                    value={fromText}
                    onChange={e => setFromText(e.target.value)}
                    onBlur={() => setFromText(String(a))}
                  />
                  {tr('export.range.mid')}
                  <input
                    type="number"
                    min={1}
                    max={total}
                    aria-label={tr('export.range.toLabel')}
                    className={NUMBER}
                    value={toText}
                    onChange={e => setToText(e.target.value)}
                    onBlur={() => setToText(String(b))}
                  />
                  {tr('export.range.to')}
                  <span className="text-fg-faint">{tr('export.range.count', { n: hi - lo + 1 })}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-[3px]">
                  {doc?.turns.map(t => (
                    <button
                      key={t.n}
                      type="button"
                      onClick={e => pickTurn(t.n, e.shiftKey)}
                      className={cn(
                        'h-[22px] min-w-6 rounded px-1 font-mono text-[11px] leading-[22px]',
                        t.n >= lo && t.n <= hi ? 'bg-accent-soft text-accent-fg' : 'bg-subtle text-fg-faint',
                        hitTurns.has(t.n) && 'shadow-[inset_0_-2px_0_var(--warn)]',
                      )}
                    >
                      {t.n}
                    </button>
                  ))}
                </div>
              </>
            )}
          </Row>
          <Row label={tr('export.format')}>
            <Segmented<ExportFormat>
              label={tr('export.format')}
              value={format}
              options={EXPORT_FORMATS.map(f => ({ value: f, label: FORMAT_LABEL[f] }))}
              onChange={setFormat}
            />
            <div className="mt-1 text-meta text-fg-faint">{tr(`export.format.${format}` as TranslationKey)}</div>
          </Row>
          <Row label={tr('export.include')}>
            <label className="flex h-7 items-center gap-2 text-list text-fg">
              <input type="checkbox" checked={tools} onChange={e => setTools(e.target.checked)} />
              {tr('export.include.tools')}
              <span className="text-meta text-fg-faint">{tr('export.include.toolsHint')}</span>
            </label>
            <label className="flex h-7 items-center gap-2 text-list text-fg">
              <input type="checkbox" checked={thinking} onChange={e => setThinking(e.target.checked)} />
              {tr('export.include.thinking')}
            </label>
          </Row>
          <Row label={tr('export.preview')}>
            <div className="rounded-lg border border-line-card bg-surface px-3 py-2">
              {empty ? (
                <div className="text-list text-fg-muted">{tr('export.preview.empty')}</div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-meta text-fg">{fileName}</span>
                    <span className="shrink-0 text-meta text-fg-muted">
                      {tr('export.preview.size', { size: sizeLabel(text) })}
                    </span>
                  </div>
                  <div className="mt-0.5 text-meta text-fg-muted">
                    {tr('export.preview.counts', { u: counts.users, a: counts.replies, t: counts.tools })}
                  </div>
                </>
              )}
            </div>
            {hits.length === 0 && !empty && (
              <div className="mt-2 flex items-center gap-1.5 text-meta text-fg-muted">
                <ShieldCheck size={13} strokeWidth={1.75} className="shrink-0 text-success" />
                {tr('export.scan.clean')}
              </div>
            )}
          </Row>
          {hits.length > 0 && (
            <div
              role="group"
              aria-label={tr('export.warn.title', { n: hits.length })}
              data-export-secrets
              className="mt-2 overflow-hidden rounded-lg border border-warn/40 bg-warn/10"
            >
              <div className="flex items-center gap-2 px-3 pt-2 pb-1 font-semibold text-fg">
                <ShieldAlert size={16} strokeWidth={1.75} className="shrink-0 text-warn" />
                {tr('export.warn.title', { n: hits.length })}
                <span className="ml-auto text-meta font-normal text-fg-muted">{tr('export.warn.note')}</span>
              </div>
              <div className="px-1.5">
                {hits.slice(0, HITS_SHOWN).map((hit, i) => (
                  <div
                    key={i}
                    className="grid h-[30px] grid-cols-[56px_132px_minmax(0,1fr)_auto] items-center gap-2 rounded px-1.5 hover:bg-hover"
                  >
                    <span className="truncate rounded bg-warn/15 px-1.5 text-center font-mono text-meta text-warn-fg">
                      {hitKindLabel(hit)}
                    </span>
                    <span className="truncate text-meta text-fg-muted">
                      {tr('export.where', { n: hit.turn, source: tr(`export.source.${hit.source}` as TranslationKey) })}
                    </span>
                    <span className="truncate rounded bg-subtle px-1.5 font-mono text-meta text-fg">{hit.snippet}</span>
                    <button
                      type="button"
                      onClick={() => view(hit.anchor)}
                      className="text-meta text-accent-fg hover:underline"
                    >
                      {tr('export.hit.view')}
                    </button>
                  </div>
                ))}
                {hits.length > HITS_SHOWN && (
                  <div className="h-6 px-1.5 text-meta text-fg-muted">
                    {tr('export.more', { n: hits.length - HITS_SHOWN })}
                  </div>
                )}
              </div>
              <div
                role="radiogroup"
                aria-label={tr('export.choice.label')}
                className="mt-1.5 border-t border-warn/25 bg-surface/70 px-3 py-1.5"
              >
                {(['mask', 'raw'] as const).map(value => (
                  <label key={value} className="flex items-start gap-2 py-1">
                    <input
                      type="radio"
                      name="export-secret-choice"
                      className="mt-0.5"
                      checked={choice === value}
                      onChange={() => setChoice(value)}
                    />
                    <span className="min-w-0">
                      <span className="block text-list font-medium text-fg">{tr(`export.choice.${value}`)}</span>
                      <span className="block text-meta text-fg-muted">{tr(`export.choice.${value}Hint`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      }
      confirmLabel={confirmLabel}
      cancelLabel={tr('export.btn.cancel')}
      busy={busy}
      error={error}
      warn={hits.length > 0 && choice === 'raw'}
      confirmDisabled={empty}
      extra={empty ? undefined : { label: tr('export.btn.copy'), onClick: () => start('copy') }}
      onConfirm={() => start('save')}
      onCancel={closeExport}
    />
  )
}
