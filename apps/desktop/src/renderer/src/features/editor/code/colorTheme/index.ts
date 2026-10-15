import { Prec, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { baseHighlight } from '../theme'
import { notifyEditorPacksChanged } from '../packEvents'
import { contributionsOf, onUiThemeChange, readPackJson, subscribePacks, uiTheme } from '@/features/extpacks/store'
import { packIdRef } from '@/features/extpacks/model'
import { convertColors, convertTokenColors, mergeIncludes } from './convert'
import { getEditorThemeChoice, onEditorThemeChoiceChange } from './store'

// 当前生效的颜色主题。选了扩展主题就用它的着色 + 编辑器外观 + 对比视图配色（都是 Prec.highest，盖过默认和 keyHighlight）；
// 没选或主题不可用就是内置着色。
// 只订阅 subscribePacks / onUiThemeChange / 自己的选择变化，不能订阅 onEditorPacksChanged：加载完我们自己会 notify，会死循环。

let current: Extension = baseHighlight
let started = false
let loadSeq = 0
let wantedSig = ''

function resolveTheme(): { sig: string; key: string; path: string; dark: boolean } | null {
  const mode = uiTheme()
  const ref = packIdRef(getEditorThemeChoice()[mode] ?? '')
  if (!ref) return null
  const hit = contributionsOf('themes').find(
    c => c.pack.id === ref.packId && c.item.id === ref.itemId && c.item.uiTheme === mode,
  )
  if (!hit) return null
  return {
    sig: `${mode}|${hit.pack.key}@${hit.pack.revision}|${hit.item.path}`,
    key: hit.pack.key,
    path: hit.item.path,
    dark: mode === 'dark',
  }
}

function apply(next: Extension): void {
  if (next === current) return
  current = next
  notifyEditorPacksChanged()
}

async function build(key: string, path: string, dark: boolean): Promise<Extension> {
  const doc = (await mergeIncludes(p => readPackJson(key, p), path)) as {
    colors?: unknown
    tokenColors?: unknown
  } | null
  const { rules, warnings } = convertTokenColors(doc?.tokenColors)
  if (warnings.length) console.warn('[extpacks] colour theme', path, warnings)
  const { chrome, diff } = convertColors(doc?.colors, dark)
  const style = HighlightStyle.define(rules.map(({ tags, ...css }) => ({ tag: tags, ...css })))
  return [
    Prec.highest(syntaxHighlighting(style)),
    Prec.highest(EditorView.theme(chrome, { dark })),
    Prec.highest(EditorView.theme(diff)),
  ]
}

function load(): void {
  const target = resolveTheme()
  const sig = target?.sig ?? 'none'
  // 同一个目标已经在加载或已生效：什么都不做（扩展状态每次广播都会走到这里）
  if (sig === wantedSig) return
  wantedSig = sig
  const seq = ++loadSeq
  if (!target) {
    apply(baseHighlight)
    return
  }
  build(target.key, target.path, target.dark)
    .then(ext => {
      if (seq === loadSeq) apply(ext)
    })
    .catch(err => {
      console.warn('[extpacks] colour theme failed', target.path, err)
      if (seq === loadSeq) apply(baseHighlight)
    })
}

function start(): void {
  if (started) return
  started = true
  subscribePacks(load)
  onUiThemeChange(load)
  onEditorThemeChoiceChange(load)
  load()
}

export function editorColorTheme(): Extension {
  start()
  return current
}
