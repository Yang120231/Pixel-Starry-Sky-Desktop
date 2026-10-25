// 对话导出（docs/ui/conversation-export.md）：把会话条目整理成「轮次 → 片段」，扫描密钥、打码，再渲染成 Markdown / HTML / JSON。
// 全是纯函数，对话框、命令面板、测试共用
import { ENGINES, type Item, type SessionRecord } from '@pixelsky/protocol'
import { getLocale, tr } from '@/i18n/core'
import { startsTurn } from '@/features/session/turnComments'
import { formatBytes } from '@/features/panel/artifacts/artifactsModel'
import { safeFileName } from '../../../../shared/safeFileName'
import { hitSnippet, redactSecrets, scanSecrets, type SecretKind } from '../../../../shared/secrets/scan'

export type ExportFormat = 'md' | 'html' | 'json'
export const EXPORT_FORMATS: readonly ExportFormat[] = ['md', 'html', 'json']

/** 命中出在哪里：用户消息、回复、思考、工具调用那一行、命令输出、读到的文件内容 */
export type ExportSource = 'user' | 'reply' | 'thinking' | 'command' | 'output' | 'file'

export type Part =
  | { kind: 'user'; id: string; text: string; at: number; attached: string[] }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'reasoning'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      /** 「命令」「读取」「编辑」… */
      label: string
      /** 一行摘要：命令、路径、搜索词 */
      summary: string
      /** 输出（已截断）；没有为空串 */
      detail: string
      /** 读文件工具：detail 是文件内容，扫描时标「读取的文件」 */
      fileRead: boolean
      failed: boolean
    }

export interface Turn {
  /** 第几轮，从 1 数（和对话里的评论、检查点编号一致） */
  n: number
  /** 这一轮开头那条用户消息的 id，「查看」滚动到它 */
  anchor: string | null
  parts: Part[]
}

export interface ExportDoc {
  title: string
  engine: string
  model: string
  /** 导出时间（毫秒） */
  at: number
  /** 整个会话一共几轮（范围外的轮次不在 turns 里） */
  total: number
  turns: Turn[]
}

export interface ExportOptions {
  format: ExportFormat
  tools: boolean
  thinking: boolean
  /** 轮次范围，含两端，从 1 数 */
  from: number
  to: number
}

/** 工具输出最多带这么多字符：命令输出动辄几万行，导出的是「记录」不是完整日志 */
export const DETAIL_LIMIT = 2000
const SUMMARY_LIMIT = 200

const oneLine = (text: string): string => {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > SUMMARY_LIMIT ? line.slice(0, SUMMARY_LIMIT) + '…' : line
}
const clip = (text: string): string =>
  text.length > DETAIL_LIMIT
    ? text.slice(0, DETAIL_LIMIT) + '\n' + tr('export.file.truncated', { n: text.length })
    : text

const TOOL_LABEL = {
  read: 'export.tool.read',
  search: 'export.tool.search',
  web: 'export.tool.web',
  mcp: 'export.tool.mcp',
  task: 'export.tool.task',
} as const

function partOf(item: Item): Part | null {
  switch (item.kind) {
    case 'user': {
      // 断线重连自动发的「继续」、没送到的消息都不是用户说的话
      if (item.reconnect !== undefined || item.dismissed) return null
      const attached = [
        ...(item.attachments?.length ? [tr('export.file.images', { n: item.attachments.length })] : []),
        ...(item.files ?? []).map(f => f.name),
      ]
      return { kind: 'user', id: item.id, text: item.text, at: item.createdAt, attached }
    }
    case 'assistant':
      return { kind: 'assistant', id: item.id, text: item.text }
    case 'reasoning':
      return { kind: 'reasoning', id: item.id, text: item.text }
    case 'command':
      return {
        kind: 'tool',
        id: item.id,
        label: tr('export.tool.command'),
        summary: oneLine(item.command),
        detail: clip(item.output),
        fileRead: false,
        failed: item.status === 'failed' || (item.exitCode !== null && item.exitCode !== 0),
      }
    case 'tool':
      return {
        kind: 'tool',
        id: item.id,
        label: item.tool === 'other' ? item.name : tr(TOOL_LABEL[item.tool]),
        summary: oneLine(item.title),
        detail: clip(item.output),
        fileRead: item.tool === 'read',
        failed: item.status === 'failed',
      }
    case 'file_change':
      return {
        kind: 'tool',
        id: item.id,
        label: tr('export.tool.edit'),
        // 只写路径和增减行数，差异内容不带
        summary: oneLine(item.changes.map(c => `${c.path} (+${c.added} -${c.removed})`).join(', ')),
        detail: '',
        fileRead: false,
        failed: item.status === 'failed',
      }
    default:
      return null
  }
}

/** 整个会话的条目 → 轮次。第一条用户消息之前的内容算在第 1 轮 */
export function buildDoc(
  items: readonly Item[],
  record: Pick<SessionRecord, 'title' | 'engine' | 'model'>,
  at: number,
): ExportDoc {
  const turns: Turn[] = []
  let current: Turn | null = null
  for (const item of items) {
    if (!current || startsTurn(item)) {
      current = { n: turns.length + 1, anchor: startsTurn(item) ? item.id : null, parts: [] }
      turns.push(current)
    }
    const part = partOf(item)
    if (part) current.parts.push(part)
  }
  // 没有可导出内容的轮次（没送到的消息、只有提示）不算一轮，编号重排
  const kept = turns.filter(t => t.parts.length > 0).map((t, i) => ({ ...t, n: i + 1 }))
  return {
    title: record.title.trim() || tr('export.file.untitled'),
    engine: ENGINES[record.engine]?.name ?? record.engine,
    model: record.model ?? '',
    at,
    total: kept.length,
    turns: kept,
  }
}

/** 会话里有没有可导出的内容 */
export const hasExportable = (items: readonly Item[] | undefined): boolean =>
  !!items?.some(i => (i.kind === 'user' && i.reconnect === undefined && !i.dismissed) || i.kind === 'assistant')

/** 第几轮：条目 id 所在的那一轮；找不到为 null（和 buildDoc 的编号一致） */
export function turnOf(doc: ExportDoc, itemId: string): number | null {
  return doc.turns.find(t => t.parts.some(p => p.id === itemId))?.n ?? null
}

/** 按范围、「工具调用」「思考」开关裁出要导出的部分；范围不合法时夹到 1..total */
export function selectDoc(doc: ExportDoc, opts: Pick<ExportOptions, 'tools' | 'thinking' | 'from' | 'to'>): ExportDoc {
  const from = Math.max(1, Math.min(opts.from, opts.to))
  const to = Math.min(doc.total, Math.max(opts.from, opts.to))
  return {
    ...doc,
    turns: doc.turns
      .filter(t => t.n >= from && t.n <= to)
      .map(t => ({
        ...t,
        parts: t.parts.filter(p => (p.kind === 'tool' ? opts.tools : p.kind === 'reasoning' ? opts.thinking : true)),
      })),
  }
}

// ---- 密钥扫描与打码 ----

type Field = { turn: number; anchor: string | null; source: ExportSource }

/** 把每个会被写进文件的文字字段过一遍 fn（标题也算，但只打码不列出） */
function mapText(doc: ExportDoc, fn: (text: string, field: Field) => string): ExportDoc {
  return {
    ...doc,
    title: fn(doc.title, { turn: 0, anchor: null, source: 'user' }),
    turns: doc.turns.map(t => {
      const at = (source: ExportSource): Field => ({ turn: t.n, anchor: t.anchor, source })
      return {
        ...t,
        parts: t.parts.map((p): Part => {
          switch (p.kind) {
            case 'user':
              return { ...p, text: fn(p.text, at('user')) }
            case 'assistant':
              return { ...p, text: fn(p.text, at('reply')) }
            case 'reasoning':
              return { ...p, text: fn(p.text, at('thinking')) }
            case 'tool':
              return {
                ...p,
                summary: fn(p.summary, at('command')),
                detail: fn(p.detail, at(p.fileRead ? 'file' : 'output')),
              }
          }
        }),
      }
    }),
  }
}

export interface ExportHit {
  turn: number
  anchor: string | null
  source: ExportSource
  kind: SecretKind
  /** 已打码的片段，不含完整明文 */
  snippet: string
}

/** 要写进文件的内容里的疑似密钥（标题里的不列，只在打码时处理） */
export function scanDoc(doc: ExportDoc): ExportHit[] {
  const out: ExportHit[] = []
  mapText(doc, (text, field) => {
    if (field.turn > 0)
      for (const hit of scanSecrets(text)) out.push({ ...field, kind: hit.kind, snippet: hitSnippet(text, hit) })
    return text
  })
  return out
}

/** 命中的部分换成 ••••（会话本身不变，这里返回新的文档） */
export const redactDoc = (doc: ExportDoc): ExportDoc => mapText(doc, text => redactSecrets(text))

// ---- 渲染 ----

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 代码围栏：比内容里最长的连续反引号再长一点 */
const fence = (text: string): string => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1)))

const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

function heading(doc: ExportDoc): string {
  const first = doc.turns[0]?.n,
    last = doc.turns.at(-1)?.n
  const meta = tr('export.file.meta', { time: stamp(doc.at), engine: doc.engine, model: doc.model || '-' })
  const range =
    first !== undefined && last !== undefined && (first !== 1 || last !== doc.total)
      ? ' · ' +
        (first === last
          ? tr('export.file.range1', { n: first, total: doc.total })
          : tr('export.file.range', { from: first, to: last, total: doc.total }))
      : ''
  return meta + range
}

const toolLine = (p: Extract<Part, { kind: 'tool' }>): string =>
  `${p.label} ${p.summary}${p.failed ? ` (${tr('export.file.failed')})` : ''}`

function toMarkdown(doc: ExportDoc): string {
  const out = [`# ${doc.title}`, '', `> ${heading(doc)}`]
  for (const turn of doc.turns) {
    out.push('', `## ${tr('export.file.turn', { n: turn.n })}`)
    for (const p of turn.parts) {
      out.push('')
      if (p.kind === 'user') {
        out.push(`**${tr('export.file.user')}**`, '', p.text)
        if (p.attached.length) out.push('', `_${tr('export.file.attached', { names: p.attached.join(', ') })}_`)
      } else if (p.kind === 'assistant') out.push(`**${tr('export.file.assistant')}**`, '', p.text)
      else if (p.kind === 'reasoning')
        out.push(`<details><summary>${tr('export.file.thinking')}</summary>`, '', p.text, '', '</details>')
      else if (p.detail) {
        const f = fence(p.detail)
        out.push(`<details><summary>${escapeHtml(toolLine(p))}</summary>`, '', f, p.detail, f, '', '</details>')
      } else out.push(`- ${toolLine(p)}`)
    }
  }
  return out.join('\n') + '\n'
}

const HTML_STYLE = `:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--card:#f6f8fa;--user:#eaf2ff}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--card:#161b22;--user:#16263d}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 system-ui,sans-serif}
main{max-width:820px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:13px;color:var(--muted);margin:32px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
.meta{color:var(--muted);font-size:13px}
.msg{border-radius:10px;padding:10px 14px;margin:10px 0;white-space:pre-wrap;word-break:break-word}
.msg .who{font-size:12px;color:var(--muted);margin-bottom:2px}
.msg.user{background:var(--user)}.msg.assistant{background:var(--card)}
details{margin:6px 0;border:1px solid var(--line);border-radius:8px;padding:4px 12px;font-size:13px}
summary{cursor:pointer;color:var(--muted)}details pre{white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Consolas,monospace;margin:8px 0}
.tool{color:var(--muted);font-size:13px;margin:6px 0}`

function toHtml(doc: ExportDoc): string {
  const e = escapeHtml
  const body = doc.turns.map(turn => {
    const parts = turn.parts.map(p => {
      if (p.kind === 'user')
        return `<div class="msg user"><div class="who">${e(tr('export.file.user'))}</div>${e(p.text)}${
          p.attached.length
            ? `<div class="who">${e(tr('export.file.attached', { names: p.attached.join(', ') }))}</div>`
            : ''
        }</div>`
      if (p.kind === 'assistant')
        return `<div class="msg assistant"><div class="who">${e(tr('export.file.assistant'))}</div>${e(p.text)}</div>`
      if (p.kind === 'reasoning')
        return `<details><summary>${e(tr('export.file.thinking'))}</summary><pre>${e(p.text)}</pre></details>`
      return p.detail
        ? `<details><summary>${e(toolLine(p))}</summary><pre>${e(p.detail)}</pre></details>`
        : `<div class="tool">${e(toolLine(p))}</div>`
    })
    return `<section><h2>${e(tr('export.file.turn', { n: turn.n }))}</h2>\n${parts.join('\n')}\n</section>`
  })
  return `<!doctype html>
<html lang="${getLocale() === 'en-US' ? 'en' : 'zh-CN'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(doc.title)}</title>
<style>${HTML_STYLE}</style></head>
<body><main>
<h1>${e(doc.title)}</h1>
<div class="meta">${e(heading(doc))}</div>
${body.join('\n')}
</main></body></html>
`
}

function toJson(doc: ExportDoc, redacted: number): string {
  return (
    JSON.stringify(
      {
        format: 'pixelsky-conversation',
        version: 1,
        title: doc.title,
        engine: doc.engine,
        model: doc.model,
        exportedAt: new Date(doc.at).toISOString(),
        totalTurns: doc.total,
        redacted,
        turns: doc.turns.map(t => ({
          turn: t.n,
          items: t.parts.map(p =>
            p.kind === 'user'
              ? { role: p.kind, text: p.text, at: new Date(p.at).toISOString(), attached: p.attached }
              : p.kind === 'tool'
                ? { role: p.kind, label: p.label, summary: p.summary, output: p.detail, failed: p.failed }
                : { role: p.kind, text: p.text },
          ),
        })),
      },
      null,
      2,
    ) + '\n'
  )
}

/** doc 已经按范围裁好、按需打过码；redacted 只写进 JSON 的 redacted 字段 */
export function renderDoc(doc: ExportDoc, format: ExportFormat, redacted = 0): string {
  return format === 'md' ? toMarkdown(doc) : format === 'html' ? toHtml(doc) : toJson(doc, redacted)
}

// ---- 预览、文件名 ----

export interface ExportSummary {
  users: number
  replies: number
  tools: number
}

export function summarize(doc: ExportDoc): ExportSummary {
  const parts = doc.turns.flatMap(t => t.parts)
  return {
    users: parts.filter(p => p.kind === 'user').length,
    replies: parts.filter(p => p.kind === 'assistant').length,
    tools: parts.filter(p => p.kind === 'tool').length,
  }
}

export const byteSize = (text: string): number => new TextEncoder().encode(text).length
export const sizeLabel = (text: string): string => formatBytes(byteSize(text))

/** 保存对话框里的默认文件名（不含扩展名）：标题，选了部分轮次时加「（第 3–8 轮）」；去掉文件名里不能用的字符 */
export function exportBaseName(doc: ExportDoc): string {
  const first = doc.turns[0]?.n,
    last = doc.turns.at(-1)?.n
  const partial = first !== undefined && last !== undefined && (first !== 1 || last !== doc.total)
  const rangeName =
    first === last ? tr('export.file.turnName', { n: first }) : tr('export.file.rangeName', { from: first, to: last })
  const raw = doc.title + (partial ? rangeName : '')
  return safeFileName(raw, 80, 'conversation')
}
