import { describe, expect, it } from 'vitest'
import {
  PAGE_HELPERS,
  clampRect,
  elementExtra,
  parsePickMessage,
  pickerScript,
  sanitizePickConfig,
} from './elementPicker'

interface Fake {
  nodeType: 1
  tagName: string
  parentElement: Fake | null
  children?: Fake[]
  innerText?: string
  getAttribute(name: string): string | null
}
const el = (tag: string, attrs: Record<string, string> = {}, parent: Fake | null = null, innerText = ''): Fake => ({
  nodeType: 1,
  tagName: tag.toUpperCase(),
  parentElement: parent,
  innerText,
  getAttribute: name => attrs[name] ?? null,
})
const helpers = new Function(`${PAGE_HELPERS}; return { psSelector, psText, psSegment }`)() as {
  psSelector(el: Fake, doc?: unknown): string
  psText(el: Fake, max: number): string
  psSegment(el: Fake): string
}

describe('点选元素：选择器', () => {
  const html = el('html'),
    body = el('body', {}, html)
  it('有 id 用 id，有 data-testid 用它，到此为止不再往上', () => {
    const form = el('form', { class: 'checkout' }, body)
    expect(helpers.psSelector(el('button', { id: 'submit' }, form))).toBe('#submit')
    expect(helpers.psSelector(el('button', { 'data-testid': 'pay', class: 'primary' }, form))).toBe(
      '[data-testid="pay"]',
    )
    expect(helpers.psSelector(el('span', { class: 'x' }, el('div', { id: 'root' }, body)))).toBe('#root span.x')
  })
  it('否则最多 3 层 class 链，每层标签名加至多 2 个 class，不认识的 class 写法跳过', () => {
    const form = el('form', { class: 'checkout' }, body)
    const summary = el('div', { class: 'summary' }, form)
    const box = el('div', { class: 'box' }, summary)
    const button = el('button', { class: 'primary md:flex big extra' }, box)
    expect(helpers.psSelector(button)).toBe('div.summary div.box button.primary.big')
    expect(helpers.psSelector(el('p', {}, body))).toBe('p')
  })
  it('选择器在页面里不唯一时，目标段加 :nth-of-type', () => {
    const list = el('ul', { class: 'list' }, body),
      first = el('li', { class: 'row' }, list),
      second = el('li', { class: 'row' }, list)
    list.children = [first, second]
    const doc = { querySelectorAll: () => [first, second] }
    expect(helpers.psSelector(second, doc)).toBe('ul.list li.row:nth-of-type(2)')
  })
  it('自己带重复的 data-testid（列表行）时也补 :nth-of-type', () => {
    const list = el('ul', {}, body),
      first = el('li', { 'data-testid': 'todo-item' }, list),
      second = el('li', { 'data-testid': 'todo-item' }, list)
    list.children = [first, second]
    const doc = { querySelectorAll: () => [first, second] }
    expect(helpers.psSelector(second, doc)).toBe('[data-testid="todo-item"]:nth-of-type(2)')
  })
  it('元素文字去掉多余空白、最多取 max 个字；没有文字时退到 aria-label / placeholder', () => {
    expect(helpers.psText(el('b', {}, null, '  提交 \n  订单 '), 80)).toBe('提交 订单')
    expect(helpers.psText(el('b', {}, null, 'x'.repeat(200)), 80)).toHaveLength(80)
    expect(helpers.psText(el('input', { placeholder: '优惠码' }), 80)).toBe('优惠码')
  })
})

describe('点选元素：回传消息只认带口令的、内容重新校验', () => {
  const channel = 'pixelsky-pick:abc:'
  const add = {
    t: 'add',
    route: '/checkout',
    selector: 'form.checkout button.primary',
    label: 'button.primary',
    text: '提交订单',
    w: 186.4,
    h: 36,
    note: ' 加 loading ',
    off: ['shot', 'bogus'],
    rect: { x: 10, y: 20, width: 100, height: 50 },
  }
  it('口令对不上、不是 JSON、类型不认识的一律丢弃', () => {
    expect(parsePickMessage(JSON.stringify(add), channel)).toBeNull()
    expect(parsePickMessage('pixelsky-pick:evil:' + JSON.stringify(add), channel)).toBeNull()
    expect(parsePickMessage(channel + '{oops', channel)).toBeNull()
    expect(parsePickMessage(channel + JSON.stringify({ t: 'run' }), channel)).toBeNull()
    expect(parsePickMessage(42, channel)).toBeNull()
  })
  it('add：字段按类型和长度重新整理，没有意见 / 选择器 / 路由的丢弃', () => {
    const msg = parsePickMessage(channel + JSON.stringify(add), channel)
    expect(msg).toEqual({
      t: 'add',
      note: '加 loading',
      extra: {
        route: '/checkout',
        selector: 'form.checkout button.primary',
        label: 'button.primary',
        element: '提交订单',
        size: { width: 186, height: 36 },
        off: ['shot'],
      },
      rect: { x: 10, y: 20, width: 100, height: 50 },
    })
    for (const bad of [{ note: '  ' }, { selector: '' }, { route: undefined }])
      expect(parsePickMessage(channel + JSON.stringify({ ...add, ...bad }), channel)).toBeNull()
    const long = parsePickMessage(channel + JSON.stringify({ ...add, text: 'x'.repeat(500) }), channel)
    expect(long?.t === 'add' && long.extra.element).toHaveLength(80)
  })
  it('exit 和 missing', () => {
    expect(parsePickMessage(channel + '{"t":"exit"}', channel)).toEqual({ t: 'exit' })
    expect(parsePickMessage(channel + '{"t":"missing","ids":["a",3,"b"]}', channel)).toEqual({
      t: 'missing',
      ids: ['a', 'b'],
    })
  })
})

describe('批注字段校验（网页回传、界面放回列表共用）', () => {
  const shot = 'data:image/jpeg;base64,/9j/4AAQ'
  it('截图只认 JPEG data URL 且要有尺寸；off 只留认识的项', () => {
    expect(elementExtra({ shot, shotSize: { width: 10, height: 5 } })).toEqual({
      shot,
      shotSize: { width: 10, height: 5 },
    })
    expect(elementExtra({ shot, shotSize: { width: 0, height: 5 } })).toEqual({})
    expect(elementExtra({ shot: 'data:text/html;base64,AAAA', shotSize: { width: 1, height: 1 } })).toEqual({})
    expect(elementExtra({ shot: 'javascript:alert(1)', shotSize: { width: 1, height: 1 } })).toEqual({})
    expect(elementExtra({ off: ['route', 'x', 'route', 'element'] })).toEqual({ off: ['route', 'element'] })
  })
  it('不是对象、陌生字段（id、text、url、missing）都忽略', () => {
    expect(elementExtra(null)).toEqual({})
    expect(elementExtra({ id: 'x', text: 'y', url: 'z', missing: true, selector: '.a' })).toEqual({ selector: '.a' })
  })
})

describe('界面传来的主题和文案', () => {
  it('缺的用默认值；带分号、花括号的颜色和控制字符的文案丢弃', () => {
    const c = sanitizePickConfig({
      theme: { accent: 'rgb(1, 2, 3)', onAccent: 'red;}body{display:none', mono: '"JetBrains Mono", monospace' },
      text: { add: 'OK', cancel: 'a\nb', title: 7 },
    })
    expect(c.theme.accent).toBe('rgb(1, 2, 3)')
    expect(c.theme.onAccent).toBe('#FFFFFF')
    expect(c.theme.mono).toBe('"JetBrains Mono", monospace')
    expect(c.text.add).toBe('OK')
    expect(c.text.cancel).toBe('取消')
    expect(c.text.title).toBe('添加批注')
    expect(sanitizePickConfig(undefined).text.hint).toContain('Esc')
  })
})

describe('截图区域', () => {
  it('取整并夹在视图里；整块在视图外返回 null', () => {
    expect(clampRect({ x: -10.5, y: 5.2, width: 60, height: 30.1 }, 100, 100)).toEqual({
      x: 0,
      y: 5,
      width: 50,
      height: 31,
    })
    expect(clampRect({ x: 90, y: 90, width: 50, height: 50 }, 100, 100)).toEqual({
      x: 90,
      y: 90,
      width: 10,
      height: 10,
    })
    expect(clampRect({ x: 120, y: 0, width: 10, height: 10 }, 100, 100)).toBeNull()
  })
})

describe('注入脚本', () => {
  const script = pickerScript({
    config: sanitizePickConfig(null),
    channel: 'pixelsky-pick:abc:',
    picking: true,
    markers: [{ id: 'a', n: 1, route: '/', selector: '#x' }],
  })
  it('能被解析（不是语法错误），配置、标记、开关都带进去了', () => {
    expect(() => new Function(script)).not.toThrow()
    expect(script).toContain('__psPicker.setPicking(true)')
    expect(script).toContain('"selector":"#x"')
  })
  it('不碰界面的任何通道：脚本里没有 pixelsky、ipcRenderer、require', () => {
    for (const word of ['window.pixelsky', 'ipcRenderer', 'require(', 'electron']) expect(script).not.toContain(word)
  })
})
