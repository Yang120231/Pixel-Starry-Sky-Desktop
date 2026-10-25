// 网页预览里点选元素批注（docs/ui/element-annotation.md）：注入网页的脚本 + 主进程这边的校验。
// 脚本跑在 Electron 的隔离 world 里（网页读不到它的变量），只用 console 消息把数据回传，不暴露任何 IPC。
// 不导入 electron；脚本写成字符串而不是函数，避免构建工具往函数体里塞辅助函数、注入网页后找不到。
import type { BrowserAnnotation, ElementNoteField } from '../../shared/types/project-browser'

export const PICK_WORLD_ID = 1001
export const NOTE_FIELDS: readonly ElementNoteField[] = ['route', 'selector', 'element', 'shot']
/** 元素文字、元素截图的上限 */
export const ELEMENT_TEXT_MAX = 80
export const SHOT_MAX_EDGE = 720
export const SHOT_PADDING = 16
const SHOT_DATA_MAX = 400_000

const THEME_KEYS = ['accent', 'onAccent', 'popover', 'surface', 'text', 'muted', 'border', 'mono'] as const
const TEXT_KEYS = [
  'hint',
  'title',
  'placeholder',
  'cancel',
  'add',
  'auto',
  'route',
  'selector',
  'element',
  'shot',
] as const
export interface PickConfig {
  theme: Record<(typeof THEME_KEYS)[number], string>
  text: Record<(typeof TEXT_KEYS)[number], string>
}
const DEFAULT_CONFIG: PickConfig = {
  theme: {
    accent: '#2D6151',
    onAccent: '#FFFFFF',
    popover: '#FFFFFF',
    surface: '#FFFFFF',
    text: '#20211F',
    muted: '#777872',
    border: '#E2E2DC',
    mono: 'Consolas, monospace',
  },
  text: {
    hint: '点击要批注的元素  Esc 退出',
    title: '添加批注',
    placeholder: '写下对这个元素的意见',
    cancel: '取消',
    add: '添加',
    auto: '自动带上',
    route: '路由',
    selector: '选择器',
    element: '元素文字',
    shot: '截图',
  },
}

/** 界面传来的主题色和文案：按键取字符串，长度和字符受限，缺的用默认值（颜色只会进 CSS 自定义属性，文案只用 textContent） */
export function sanitizePickConfig(raw: unknown): PickConfig {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = <K extends string>(keys: readonly K[], group: unknown, fallback: Record<K, string>, safe: RegExp) => {
    const g = (group && typeof group === 'object' ? group : {}) as Record<string, unknown>
    const out = { ...fallback }
    for (const key of keys) {
      const v = g[key]
      if (typeof v === 'string' && v.length > 0 && v.length <= 200 && safe.test(v)) out[key] = v
    }
    return out
  }
  return {
    theme: pick(THEME_KEYS, source.theme, DEFAULT_CONFIG.theme, /^[#\w\s(),.%/'"-]+$/),
    text: pick(TEXT_KEYS, source.text, DEFAULT_CONFIG.text, /^[^\r\n]+$/),
  }
}

const dims = (v: unknown): { width: number; height: number } | undefined => {
  const d = v as { width?: unknown; height?: unknown } | null
  return d &&
    typeof d === 'object' &&
    Number.isInteger(d.width) &&
    Number.isInteger(d.height) &&
    (d.width as number) > 0 &&
    (d.height as number) > 0 &&
    (d.width as number) <= 100_000 &&
    (d.height as number) <= 100_000
    ? { width: d.width as number, height: d.height as number }
    : undefined
}

export type ElementExtra = Partial<
  Pick<BrowserAnnotation, 'route' | 'selector' | 'label' | 'element' | 'size' | 'shot' | 'shotSize' | 'off'>
>

/** 点选元素批注的字段：来自网页回传、也来自界面「放回列表」，一律按类型和长度重新校验，只留认识的 */
export function elementExtra(raw: unknown): ElementExtra {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: ElementExtra = {}
  const str = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : undefined)
  const route = str(r.route, 500),
    selector = str(r.selector, 500),
    label = str(r.label, 200),
    element = str(r.element, ELEMENT_TEXT_MAX)
  if (route) out.route = route
  if (selector) out.selector = selector
  if (label) out.label = label
  if (element) out.element = element
  const size = dims(r.size)
  if (size) out.size = size
  if (
    typeof r.shot === 'string' &&
    r.shot.length <= SHOT_DATA_MAX &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(r.shot) &&
    dims(r.shotSize)
  ) {
    out.shot = r.shot
    out.shotSize = dims(r.shotSize)
  }
  if (Array.isArray(r.off)) {
    const off = NOTE_FIELDS.filter(f => (r.off as unknown[]).includes(f))
    if (off.length) out.off = off
  }
  return out
}

export interface PickRect {
  x: number
  y: number
  width: number
  height: number
}
export type PickMessage =
  | { t: 'add'; note: string; extra: ElementExtra; rect: PickRect | null }
  | { t: 'exit' }
  | { t: 'missing'; ids: string[] }

/** 网页回传的 console 消息：口令（channel）对得上才认，内容再校验一遍；其余一律丢弃 */
export function parsePickMessage(message: unknown, channel: string): PickMessage | null {
  if (typeof message !== 'string' || !message.startsWith(channel) || message.length > 20_000) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(message.slice(channel.length))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  if (raw.t === 'exit') return { t: 'exit' }
  if (raw.t === 'missing')
    return {
      t: 'missing',
      ids: Array.isArray(raw.ids) ? raw.ids.filter((id): id is string => typeof id === 'string').slice(0, 200) : [],
    }
  if (raw.t !== 'add') return null
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 4000) : ''
  const extra = elementExtra({
    route: raw.route,
    selector: raw.selector,
    label: raw.label,
    element: typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim() : undefined,
    size: { width: Math.round(Number(raw.w)), height: Math.round(Number(raw.h)) },
    off: raw.off,
  })
  if (!note || !extra.selector || !extra.route) return null
  const rr = raw.rect as Partial<PickRect> | null
  const rect =
    rr && [rr.x, rr.y, rr.width, rr.height].every(n => typeof n === 'number' && Number.isFinite(n))
      ? { x: rr.x!, y: rr.y!, width: rr.width!, height: rr.height! }
      : null
  return { t: 'add', note, extra, rect }
}

/** 截图区域取整并夹在视图里；夹完没有面积返回 null */
export function clampRect(r: PickRect, width: number, height: number): PickRect | null {
  const x = Math.max(0, Math.floor(r.x)),
    y = Math.max(0, Math.floor(r.y))
  const w = Math.min(width, Math.ceil(r.x + r.width)) - x,
    h = Math.min(height, Math.ceil(r.y + r.height)) - y
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null
}

/** 页面里的辅助函数（选择器、元素文字）：单独成串，测试里直接求值 */
export const PAGE_HELPERS = String.raw`
function psEsc(s) {
  s = String(s);
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return s.replace(/[^\w-]/g, function (c) { return '\\' + c; });
}
function psClasses(el) {
  var c = el.getAttribute && el.getAttribute('class');
  if (!c) return [];
  return c.split(/\s+/).filter(function (x) { return x && x.length <= 40 && /^[A-Za-z_-][\w-]*$/.test(x); }).slice(0, 2);
}
function psSegment(el) {
  return String(el.tagName || '').toLowerCase() + psClasses(el).map(function (c) { return '.' + psEsc(c); }).join('');
}
function psSelector(el, doc) {
  var parts = [], cur = el, depth = 0;
  while (cur && cur.nodeType === 1 && depth < 3) {
    var id = cur.getAttribute('id');
    if (id) { parts.unshift('#' + psEsc(id)); break; }
    var tid = cur.getAttribute('data-testid');
    if (tid) { parts.unshift('[data-testid="' + String(tid).replace(/["\\]/g, '\\$&') + '"]'); break; }
    var tag = String(cur.tagName || '').toLowerCase();
    if (tag === 'html' || tag === 'body') { if (!parts.length) parts.unshift(tag); break; }
    parts.unshift(psSegment(cur));
    cur = cur.parentElement;
    depth++;
  }
  var sel = parts.join(' ');
  if (doc && sel) {
    try {
      var found = doc.querySelectorAll(sel);
      if (found.length !== 1 || found[0] !== el) {
        var p = el.parentElement, n = 0, idx = 1;
        if (p) for (var i = 0; i < p.children.length; i++) {
          if (p.children[i].tagName === el.tagName) { n++; if (p.children[i] === el) idx = n; }
        }
        parts[parts.length - 1] += ':nth-of-type(' + idx + ')';
        sel = parts.join(' ');
      }
    } catch (e) {}
  }
  return sel;
}
function psText(el, max) {
  var t = (el.innerText != null ? el.innerText : el.textContent) || '';
  if (!String(t).trim()) t = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('title') || '';
  return String(t).replace(/\s+/g, ' ').trim().slice(0, max);
}
`

const PICKER = String.raw`
(function () {
  if (window.__psPicker) return;
  var log = console.info.bind(console);
  var channel = '', cfg = null, picking = false, markers = [], lastMissing = null;
  var host = null, root = null, layer = null, outline = null, tag = null, hint = null, box = null, boxEl = null, hover = null;
  var timer = 0, frame = 0, resumeTimer = 0, prevCursor = null;
  function send(msg) { if (channel) log(channel + JSON.stringify(msg)); }
  function h(name, cls, text) {
    var e = document.createElement(name);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  var CSS_TEXT = [
    '*{box-sizing:border-box}',
    '.hv{position:fixed;pointer-events:none;border-radius:6px;outline:2px solid var(--a);outline-offset:1px;background:color-mix(in srgb,var(--a) 14%,transparent)}',
    '.tg{position:absolute;right:-3px;bottom:calc(100% + 5px);display:flex;gap:8px;padding:2px 7px;border-radius:4px;background:var(--a);color:var(--on);font:11px/1.5 var(--m);white-space:nowrap}',
    '.tg.b{bottom:auto;top:calc(100% + 5px)}.tg i{font-style:normal;opacity:.7}',
    '.mk{position:fixed;width:20px;height:20px;border-radius:50%;background:var(--a);color:var(--on);font:600 11px/20px system-ui,sans-serif;text-align:center;transform:translate(-50%,-50%);box-shadow:0 0 0 2px var(--sf);pointer-events:none}',
    '.hint{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);height:26px;padding:0 12px;border-radius:999px;border:1px solid var(--bd);background:var(--po);color:var(--fg);box-shadow:0 4px 14px rgba(0,0,0,.14);white-space:nowrap;font:11.5px/24px system-ui,sans-serif;pointer-events:none}',
    '.box{position:fixed;width:300px;pointer-events:auto;background:var(--po);color:var(--fg);border:1px solid var(--bd);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);font:12px/1.5 system-ui,sans-serif}',
    '.box .hd{display:flex;align-items:center;gap:8px;height:34px;padding:0 6px 0 12px}.box .hd b{font-weight:600}.box .hd i{font:11px var(--m);color:var(--mu);font-style:normal;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.box button{font:inherit;cursor:pointer}',
    '.box .x{width:24px;height:24px;border:0;border-radius:6px;background:none;color:var(--mu)}.box .x:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}',
    '.box textarea{display:block;width:calc(100% - 24px);margin:0 12px;height:62px;resize:none;border:1px solid var(--a);border-radius:6px;background:var(--sf);color:var(--fg);padding:6px 8px;font:inherit;outline:none}',
    '.box .au{margin:10px 12px 0;display:flex;flex-direction:column;gap:6px}.box .au>span{color:var(--mu);font-size:11px}',
    '.box .ai{display:flex;align-items:flex-start;gap:8px;cursor:pointer}.box .ai input{margin:2px 0 0;accent-color:var(--a)}',
    '.box .ai em{font-style:normal;width:52px;color:var(--mu);flex-shrink:0}.box .ai .v{flex:1;min-width:0;word-break:break-all;font:11px/1.5 var(--m)}',
    '.box .ft{display:flex;justify-content:flex-end;gap:8px;padding:10px 12px 12px}',
    '.box .ft button{height:26px;padding:0 12px;border-radius:6px;border:1px solid var(--bd);background:var(--sf);color:var(--fg)}',
    '.box .ft .ok{background:var(--a);border-color:var(--a);color:var(--on)}.box .ft .ok:disabled{opacity:.5;cursor:default}'
  ].join('');
  function ensure() {
    if (host) return;
    host = document.createElement('div');
    host.setAttribute('data-pixelsky-pick', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    root = host.attachShadow({ mode: 'closed' });
    var style = document.createElement('style');
    style.textContent = CSS_TEXT;
    layer = h('div');
    outline = h('div', 'hv');
    outline.style.display = 'none';
    tag = h('div', 'tg');
    outline.appendChild(tag);
    root.append(style, layer, outline);
    ['keydown', 'keyup', 'keypress', 'input', 'paste'].forEach(function (t) {
      host.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    applyTheme();
    document.documentElement.appendChild(host);
    addEventListener('scroll', onView, true);
    addEventListener('resize', onView, true);
  }
  function applyTheme() {
    if (!host || !cfg) return;
    var t = cfg.theme, s = host.style;
    s.setProperty('--a', t.accent); s.setProperty('--on', t.onAccent); s.setProperty('--po', t.popover);
    s.setProperty('--sf', t.surface); s.setProperty('--fg', t.text); s.setProperty('--mu', t.muted);
    s.setProperty('--bd', t.border); s.setProperty('--m', t.mono);
  }
  function pointEl(x, y) {
    var el = document.elementFromPoint(x, y);
    return el && el !== host ? el : null;
  }
  function showOutline(el) {
    var r = el.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = r.left + 'px'; outline.style.top = r.top + 'px';
    outline.style.width = r.width + 'px'; outline.style.height = r.height + 'px';
    tag.className = r.top < 30 ? 'tg b' : 'tg';
    tag.textContent = '';
    var text = psText(el, 24);
    tag.append(h('span', '', psSegment(el) + (text ? ' \u00b7 ' + text : '')), h('i', '', Math.round(r.width) + ' \u00d7 ' + Math.round(r.height)));
    tag.style.right = '-3px'; tag.style.left = 'auto';
    if (tag.getBoundingClientRect().left < 4) { tag.style.right = 'auto'; tag.style.left = '-3px'; }
  }
  function onMove(e) {
    if (box || e.target === host) return;
    hover = pointEl(e.clientX, e.clientY);
    if (hover) showOutline(hover); else outline.style.display = 'none';
  }
  function onView() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      var el = boxEl || hover;
      if (picking && el && el.isConnected) showOutline(el);
      layout();
    });
  }
  function block(e) {
    if (e.target === host) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function onClick(e) {
    if (e.target === host) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var el = pointEl(e.clientX, e.clientY);
    if (el) openBox(el);
  }
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (box) closeBox();
    else { setPicking(false); send({ t: 'exit' }); }
  }
  var BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick', 'contextmenu', 'submit', 'touchstart', 'touchend'];
  function listen(on) {
    var f = on ? 'addEventListener' : 'removeEventListener';
    BLOCKED.forEach(function (t) { window[f](t, block, true); });
    window[f]('click', onClick, true);
    window[f]('mousemove', onMove, true);
    window[f]('keydown', onKey, true);
  }
  function closeBox() {
    if (box) box.remove();
    box = null; boxEl = null; hover = null;
    if (outline) outline.style.display = 'none';
  }
  function openBox(el) {
    closeBox();
    boxEl = el;
    showOutline(el);
    var r = el.getBoundingClientRect(), t = cfg.text;
    var info = { route: location.pathname, selector: psSelector(el, document), label: psSegment(el), text: psText(el, 80), w: r.width, h: r.height };
    var rows = [
      ['route', t.route, info.route],
      ['selector', t.selector, info.selector],
      ['element', t.element, info.text],
      ['shot', t.shot, Math.round(r.width) + ' \u00d7 ' + Math.round(r.height)]
    ];
    box = h('div', 'box');
    var close = h('button', 'x', '\u00d7');
    close.type = 'button';
    close.addEventListener('click', closeBox);
    var head = h('div', 'hd');
    head.append(h('b', '', t.title), h('i', '', info.label), close);
    var ta = h('textarea');
    ta.placeholder = t.placeholder;
    ta.maxLength = 4000;
    var auto = h('div', 'au');
    auto.appendChild(h('span', '', t.auto));
    var checks = [];
    rows.forEach(function (row) {
      var label = h('label', 'ai'), cb = h('input');
      cb.type = 'checkbox';
      cb.checked = row[0] === 'shot' || !!row[2];
      checks.push([row[0], cb]);
      label.append(cb, h('em', '', row[1]), h('span', 'v', row[2] || '\u2014'));
      auto.appendChild(label);
    });
    var cancel = h('button', '', t.cancel), ok = h('button', 'ok', t.add);
    cancel.type = 'button'; ok.type = 'button'; ok.disabled = true;
    cancel.addEventListener('click', closeBox);
    ta.addEventListener('input', function () { ok.disabled = !ta.value.trim(); });
    var sending = false;
    ok.addEventListener('click', function () {
      var note = ta.value.trim();
      if (!note || sending) return;
      sending = true;
      ok.disabled = true;
      ok.textContent = '\u2026';
      var off = checks.filter(function (c) { return !c[1].checked; }).map(function (c) { return c[0]; });
      var pad = 16, rr = el.getBoundingClientRect();
      var rect = { x: rr.left - pad, y: rr.top - pad, width: rr.width + pad * 2, height: rr.height + pad * 2 };
      // 先把自己的描边和小框藏起来再让主进程截图，截完由主进程调 resume
      host.style.visibility = 'hidden';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          setTimeout(function () {
            send({ t: 'add', route: info.route, selector: info.selector, label: info.label, text: info.text, w: info.w, h: info.h, note: note, off: off, rect: rect });
            closeBox();
            clearTimeout(resumeTimer);
            resumeTimer = setTimeout(api.resume, 2000);
          }, 40);
        });
      });
    });
    var foot = h('div', 'ft');
    foot.append(cancel, ok);
    box.append(head, ta, auto, foot);
    root.appendChild(box);
    var w = 300, bh = box.getBoundingClientRect().height, left = r.right + 12, top = r.top;
    if (left + w > innerWidth - 8) left = r.left - w - 12;
    if (left < 8) { left = Math.min(Math.max(r.left, 8), innerWidth - w - 8); top = r.bottom + 12; }
    box.style.left = Math.max(8, left) + 'px';
    box.style.top = Math.max(8, Math.min(top, innerHeight - bh - 8)) + 'px';
    ta.focus();
  }
  function layout() {
    if (!host) return;
    layer.textContent = '';
    var miss = [];
    markers.forEach(function (m) {
      var el = null;
      if (m.route === location.pathname) { try { el = document.querySelector(m.selector); } catch (e) {} }
      var r = el ? el.getBoundingClientRect() : null;
      if (!r || (!r.width && !r.height)) { miss.push(m.id); return; }
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
      var d = h('div', 'mk', String(m.n));
      d.style.left = Math.min(r.right, innerWidth - 12) + 'px';
      d.style.top = Math.max(r.top, 12) + 'px';
      layer.appendChild(d);
    });
    var key = miss.join(',');
    if (key !== lastMissing) { lastMissing = key; send({ t: 'missing', ids: miss }); }
  }
  function tick() {
    var need = picking || markers.length > 0;
    if (need && !timer) timer = setInterval(layout, 500);
    if (!need && timer) { clearInterval(timer); timer = 0; }
  }
  function setPicking(on) {
    if (on === picking) return;
    picking = on;
    if (on) {
      ensure();
      listen(true);
      hint = h('div', 'hint', cfg.text.hint);
      root.appendChild(hint);
      prevCursor = document.documentElement.style.getPropertyValue('cursor');
      document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
    } else {
      listen(false);
      closeBox();
      if (hint) hint.remove();
      hint = null;
      document.documentElement.style.removeProperty('cursor');
      if (prevCursor) document.documentElement.style.setProperty('cursor', prevCursor);
    }
    tick();
  }
  var api = {
    configure: function (c, ch) { cfg = c; channel = ch; applyTheme(); },
    setPicking: setPicking,
    setMarkers: function (list) {
      markers = list;
      if (list.length) ensure();
      lastMissing = null;
      layout();
      tick();
    },
    resume: function () { clearTimeout(resumeTimer); if (host) host.style.visibility = ''; }
  };
  window.__psPicker = api;
})();
`

/** 注入脚本：配置、选取开关、标记一起交给隔离 world 里的 __psPicker（重复注入只更新状态） */
export function pickerScript(opts: {
  config: PickConfig
  channel: string
  picking: boolean
  markers: { id: string; n: number; route: string; selector: string }[]
}): string {
  return [
    PAGE_HELPERS,
    PICKER,
    `__psPicker.configure(${JSON.stringify(opts.config)}, ${JSON.stringify(opts.channel)});`,
    `__psPicker.setMarkers(${JSON.stringify(opts.markers)});`,
    `__psPicker.setPicking(${opts.picking});`,
    '__psPicker.resume();',
  ].join('\n')
}
