import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ExtensionHook } from '@pixelsky/protocol'
import { I18nProvider } from '@/i18n/I18nProvider'
import { HookList, HookWarning, commandHooks, hookEvent, hookEvents, needsHookAsk } from './hooks'

const hook = (event: string, extra: Partial<ExtensionHook> = {}): ExtensionHook => ({
  event,
  matcher: '',
  type: 'command',
  command: 'node boot.js',
  ...extra,
})
const html = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>)

describe('插件钩子事件文案', () => {
  it('已收录的事件显示中文，没收录的显示原名；同一事件只列一次', () => {
    expect(hookEvent('SessionStart')).toBe('会话开始')
    expect(hookEvent('SomethingNew')).toBe('SomethingNew')
    expect(hookEvents([hook('SessionStart'), hook('UserPromptSubmit'), hook('SessionStart')])).toBe(
      '会话开始、每条消息发送时',
    )
  })
})

describe('启用前的提示', () => {
  it('只有「启用」且带命令钩子才提示；停用、没有钩子、只有 http / prompt 钩子都直接切换', () => {
    const web = hook('Stop', { type: 'http', command: 'https://example.com/h' })
    expect(needsHookAsk(true, [hook('Stop')])).toBe(true)
    expect(needsHookAsk(true, [web, hook('Stop')])).toBe(true)
    expect(needsHookAsk(false, [hook('Stop')])).toBe(false)
    expect(needsHookAsk(true, [web])).toBe(false)
    expect(needsHookAsk(true, [])).toBe(false)
    expect(needsHookAsk(true, undefined)).toBe(false)
    expect(commandHooks([web, hook('Stop')])).toHaveLength(1)
  })
  it('提示写出事件和要运行的命令（不含 http 钩子），有取消和仍然启用两个按钮', () => {
    const out = html(
      <HookWarning
        hooks={[hook('SessionStart'), hook('Stop', { type: 'http', command: 'https://example.com/h' })]}
        busy={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(out).toContain('role="alert"')
    expect(out).toContain('这个插件会在 会话开始 时运行本机命令')
    expect(out).toContain('node boot.js')
    expect(out).not.toContain('example.com')
    expect(out).not.toContain('回复结束')
    expect(out).toContain('取消')
    expect(out).toContain('仍然启用')
  })
  it('正在处理时「仍然启用」不可点', () => {
    const out = html(<HookWarning hooks={[hook('Stop')]} busy onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(out).toMatch(/<button[^>]*disabled[^>]*>仍然启用/)
  })
})

describe('HookList', () => {
  it('每条钩子写出事件、匹配条件（空的写「每次触发」）、类型、超时和命令', () => {
    const out = html(
      <HookList
        hooks={[
          hook('SessionStart', { matcher: 'startup', timeout: 15 }),
          hook('Stop', { type: 'http', command: 'https://example.com/h' }),
        ]}
      />,
    )
    expect(out).toContain('data-extension-hooks')
    expect(out).toContain('自带钩子 · 2')
    expect(out).toContain('会话开始')
    expect(out).toContain('匹配 startup')
    expect(out).toContain('15s')
    expect(out).toContain('每次触发 · http')
    expect(out).toContain('https://example.com/h')
  })
  it('空列表只剩标题（PluginsSection 在没有钩子时不渲染它）', () => {
    const out = html(<HookList hooks={[]} />)
    expect(out).toContain('自带钩子 · 0')
    expect(out).not.toContain('<li')
  })
})
