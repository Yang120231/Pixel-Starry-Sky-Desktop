// 演示模式的 Claude Code TUI 面板（对齐 docs/ui/session-tui-toggle-mockup.html）
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Item } from '@pixelsky/protocol'
import type { DemoTuiPanelProps } from '@/data/demo'
import { tr } from '@/i18n/core'
import './DemoTuiPanel.css'

type Line =
  | { kind: 'shell'; text: string }
  | { kind: 'welcome'; cwd: string; resume: boolean; sid: string }
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; tools?: string[] }
  | { kind: 'dim'; text: string }
  | { kind: 'help' }

const REPLIES = [
  '我看了一下，`removeSent()` 只在发送成功的回调里调用，撤回不会误删。',
  '好的，已经加上了测试：发送 → 撤回 → 卡片重新出现。',
  '这个改动不影响别的面板，可以提交了。',
]

const FALLBACK_SEED: { role: 'user' | 'assistant'; text: string; tools?: string[] }[] = [
  { role: 'user', text: '批注发送之后，右边的批注残留可以删掉吗？' },
  {
    role: 'assistant',
    text: '可以。批注发送并被采纳后，右侧面板里的卡片就没用了。我把发送成功的那几条从列表里移除，底部留一行「已发送 3 条」。',
    tools: ['编辑 CommentsPanel.tsx', '编辑 store.ts'],
  },
  { role: 'user', text: '那撤回发送的时候能恢复吗？' },
  {
    role: 'assistant',
    text: '能。发送时先把卡片标成「已发送」藏起来，撤回时取消这个标记就会重新出现；真正删除放到对话结束时。',
  },
]

const SLASH_HELP = [
  '/help     显示斜杠命令',
  '/model    切换模型（演示里只提示）',
  '/compact  压缩上下文（演示里只提示）',
  '/clear    清屏（演示）',
  '/exit     退出 Claude Code',
].join('\n')

function seedFromItems(items: readonly Item[]): { role: 'user' | 'assistant'; text: string; tools?: string[] }[] {
  const out: { role: 'user' | 'assistant'; text: string; tools?: string[] }[] = []
  for (const item of items) {
    if (item.kind === 'user' && item.mode !== 'guidance') {
      const text = item.text.trim()
      if (text) out.push({ role: 'user', text: text.slice(0, 240) })
    } else if (item.kind === 'assistant' && item.status === 'completed') {
      const text = (item.text ?? '').replace(/\s+/g, ' ').trim()
      if (text) out.push({ role: 'assistant', text: text.slice(0, 320) })
    } else if (item.kind === 'tool' && out.length) {
      const last = out[out.length - 1]
      if (last.role === 'assistant') {
        const label = item.title || item.name
        if (label) last.tools = [...(last.tools ?? []), label].slice(0, 4)
      }
    } else if (item.kind === 'file_change' && out.length) {
      const last = out[out.length - 1]
      if (last.role === 'assistant') {
        const names = item.changes?.map(c => c.path.split(/[/\\]/).pop() ?? c.path).slice(0, 3) ?? []
        if (names.length) last.tools = [...(last.tools ?? []), ...names.map(n => `编辑 ${n}`)].slice(0, 4)
      }
    }
    if (out.length >= 8) break
  }
  return out.length ? out : FALLBACK_SEED
}

function buildInitial(
  cwd: string,
  sid: string,
  resume: boolean,
  seed: { role: 'user' | 'assistant'; text: string; tools?: string[] }[],
): Line[] {
  const cmd = resume ? `claude --resume ${sid}` : `claude --session-id ${sid}`
  const lines: Line[] = [
    { kind: 'shell', text: `PS ${cwd}> ${cmd}` },
    { kind: 'welcome', cwd, resume, sid },
  ]
  for (const m of seed) {
    if (m.role === 'user') lines.push({ kind: 'user', text: m.text })
    else lines.push({ kind: 'assistant', text: m.text, tools: m.tools })
  }
  if (seed.length) lines.push({ kind: 'dim', text: '' })
  return lines
}

export function DemoTuiPanel({ cwd = 'D:\\PixelSky', engineSessionId, items = [], onBack }: DemoTuiPanelProps) {
  const sid = engineSessionId || '8f3a2c1e-5b7d-4e2a-9c61-0d4e7b9a3f20'
  const resume = !!engineSessionId
  const seed = useMemo(() => seedFromItems(items), [items])
  const [lines, setLines] = useState<Line[]>(() => buildInitial(cwd, sid, resume, seed))
  const [running, setRunning] = useState(true)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [replyIdx, setReplyIdx] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLines(buildInitial(cwd, sid, resume, seed))
    setRunning(true)
    setValue('')
  }, [cwd, sid, resume, seed])

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, running, busy])

  useEffect(() => {
    inputRef.current?.focus()
  }, [running])

  const push = (line: Line) => setLines(prev => [...prev, line])

  const onSubmit = () => {
    const raw = value.trim()
    setValue('')
    if (!running) {
      if (!raw) return
      push({ kind: 'shell', text: `PS ${cwd}> ${raw}` })
      if (raw.startsWith('claude')) {
        setRunning(true)
        push({ kind: 'welcome', cwd, resume, sid })
      } else {
        push({ kind: 'dim', text: '（演示里启动 Claude 请输入 claude）' })
      }
      return
    }
    if (!raw || busy) return
    if (raw === '/exit' || raw === '/quit') {
      push({ kind: 'user', text: raw })
      push({ kind: 'dim', text: '已退出 Claude Code。' })
      setRunning(false)
      return
    }
    if (raw === '/help' || raw === '?') {
      push({ kind: 'user', text: raw })
      push({ kind: 'help' })
      return
    }
    if (raw === '/clear') {
      setLines([{ kind: 'welcome', cwd, resume, sid }])
      return
    }
    if (raw.startsWith('/')) {
      push({ kind: 'user', text: raw })
      push({ kind: 'dim', text: `演示模式：${raw} 已记下，真机才会生效。输入 /help 看可用命令。` })
      return
    }
    push({ kind: 'user', text: raw })
    setBusy(true)
    push({ kind: 'dim', text: '· Thinking…' })
    const reply = REPLIES[replyIdx % REPLIES.length]
    setReplyIdx(i => i + 1)
    window.setTimeout(() => {
      setLines(prev => {
        const next = prev.slice()
        const last = next.at(-1)
        if (last?.kind === 'dim' && last.text === '· Thinking…') next.pop()
        next.push({ kind: 'assistant', text: reply })
        return next
      })
      setBusy(false)
    }, 550)
  }

  return (
    <div className="demo-tui">
      <div className="demo-tui-bar">
        <span className="demo-tui-tab">
          <span className={running ? 'demo-tui-dot' : 'demo-tui-dot off'} aria-hidden />
          <span>{running ? 'claude · PixelSky' : 'pwsh · PixelSky'}</span>
        </span>
        <span className="demo-tui-warn">
          {tr('session.tui.bannerShort')} ·{' '}
          <button type="button" onClick={onBack}>
            {tr('session.tui.ui')}
          </button>
        </span>
      </div>

      <div className="demo-tui-body" ref={bodyRef}>
        {lines.map((line, i) => (
          <LineView key={i} line={line} />
        ))}

        {running ? (
          <>
            <div className="demo-tui-input-row">
              <span className="demo-tui-or">&gt;</span>
              <input
                ref={inputRef}
                value={value}
                disabled={busy}
                placeholder='Try "/help"'
                autoComplete="off"
                spellCheck={false}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onSubmit()
                  }
                }}
              />
            </div>
            <div className="demo-tui-help">? for shortcuts · /exit 退出 · Alt+T 切回界面</div>
          </>
        ) : (
          <div className="demo-tui-input-row shell">
            <span className="demo-tui-dim">PS {cwd}&gt;&nbsp;</span>
            <input
              ref={inputRef}
              value={value}
              autoComplete="off"
              spellCheck={false}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onSubmit()
                }
              }}
            />
          </div>
        )}
      </div>

      <div className="demo-tui-foot">
        <span>{running ? 'Claude Code · demo' : 'Shell · demo'}</span>
        <span className="ml-auto flex items-center gap-2">
          <kbd>Enter</kbd> 发送
          <kbd>/</kbd> 斜杠命令
          <kbd>Alt</kbd>+<kbd>T</kbd> 切回
        </span>
      </div>
    </div>
  )
}

function LineView({ line }: { line: Line }) {
  if (line.kind === 'shell') return <p className="demo-tui-line demo-tui-dim">{line.text}</p>
  if (line.kind === 'dim')
    return line.text ? <p className="demo-tui-line demo-tui-dim">{line.text}</p> : <p className="demo-tui-line" />
  if (line.kind === 'user')
    return (
      <p className="demo-tui-line">
        <span className="demo-tui-or">&gt;</span> {line.text}
      </p>
    )
  if (line.kind === 'assistant')
    return (
      <div className="demo-tui-line">
        {line.tools?.map(t => (
          <p key={t} className="demo-tui-dim">
            <span className="demo-tui-gr">✓</span> {t}
          </p>
        ))}
        <p>
          <span className="demo-tui-gr">·</span> {formatInline(line.text)}
        </p>
      </div>
    )
  if (line.kind === 'help')
    return (
      <pre className="demo-tui-line demo-tui-dim" style={{ margin: '4px 0 8px' }}>
        {SLASH_HELP}
      </pre>
    )
  // welcome
  return (
    <div className="demo-tui-welcome">
      <span className="demo-tui-or">✦</span> Welcome to <b>Claude Code</b>!{'\n\n'}
      {'  '}
      <span className="demo-tui-dim">cwd: {line.cwd}</span>
      {'\n'}
      {'  '}
      <span className="demo-tui-dim">
        {line.resume ? `resumed · ${line.sid.slice(0, 8)}…` : 'new session via --session-id'}
      </span>
    </div>
  )
}

function formatInline(text: string) {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((p, i) =>
    p.startsWith('`') && p.endsWith('`') ? (
      <span key={i} className="demo-tui-bl">
        {p.slice(1, -1)}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}
