// 演示模式下的扩展商店（--demo）：发现页的目录数据和一个假的预加载桥，主进程那边只回空数据。
// 目录接口的搜索、分类、排序、翻页（每页 30 个、next_before 是偏移量）在这里照云端的规则自己算一遍。
import type { ExtPackContributionKind, ExtStoreCatalogPage, ExtStoreItem, ExtStoreUpdates } from '@pixelsky/protocol'
import type { DemoSource } from '@/data/demo'
import type { ExtStoreBridge } from '../../../preload/extstore'

const PAGE = 30

/** 图标：纯色圆角方块里放两个字母（data: 地址，渲染层 CSP 放行） */
function icon(label: string, color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/>` +
    `<text x="16" y="21" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="700" fill="#fff">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const CODE: ExtPackContributionKind[] = ['grammars', 'themes', 'snippets', 'iconThemes', 'taskTemplates']
const categoriesOf = (kinds: string[]): string[] => [
  ...(kinds.some(k => CODE.includes(k as ExtPackContributionKind)) ? ['code'] : []),
  ...(kinds.some(k => k === 'skills' || k === 'prompts') ? ['ai'] : []),
]

function item(
  id: string,
  name: string,
  publisher: string,
  official: boolean,
  description: string,
  kinds: ExtPackContributionKind[],
  downloads: number,
  version: string,
  updatedAt: string,
  mark: string,
  color: string,
): ExtStoreItem {
  return {
    id,
    name,
    description,
    publisher: { name: publisher, official },
    version,
    iconUrl: icon(mark, color),
    kinds,
    categories: categoriesOf(kinds),
    downloads,
    installs: Math.round(downloads * 0.6),
    updatedAt,
  }
}

/** 按「推荐」排序的顺序：前 3 个是首屏的大卡片 */
const ITEMS: ExtStoreItem[] = [
  item(
    'pixelsky.swift',
    'Swift 支持',
    'pixelsky',
    true,
    'Swift 语法高亮、代码片段、文件图标',
    ['grammars', 'snippets', 'iconThemes'],
    1284,
    '1.2.0',
    '2026-10-15T08:00:00Z',
    'Sw',
    '#f05138',
  ),
  item(
    'enkia.tokyo-night',
    'Tokyo Night',
    'enkia',
    false,
    '深色主题，三种变体',
    ['themes'],
    940,
    '2.0.1',
    '2026-10-12T08:00:00Z',
    'TN',
    '#24283b',
  ),
  item(
    'mei.review-checklist',
    '代码审查清单',
    'mei',
    false,
    '让 AI 按团队清单审查改动',
    ['skills'],
    410,
    '1.0.3',
    '2026-10-09T08:00:00Z',
    '审',
    '#3b6fb5',
  ),
  item(
    'pixelsky.vue',
    'Vue 支持',
    'pixelsky',
    true,
    '.vue 单文件组件高亮（模板 / 脚本 / 样式）、常用片段',
    ['grammars', 'snippets'],
    2036,
    '1.3.0',
    '2026-10-14T08:00:00Z',
    'Vue',
    '#41b883',
  ),
  item(
    'pkief.material-icon',
    'Material 文件图标',
    'pkief',
    false,
    '文件树和标签上换成 Material 风格的图标，800+ 种文件',
    ['iconThemes'],
    1512,
    '4.2.0',
    '2026-10-01T08:00:00Z',
    'Mi',
    '#e8522a',
  ),
  item(
    'chen.gradle-tasks',
    'Gradle 任务',
    'chen',
    false,
    '「任务」视图里列出 build.gradle(.kts) 的任务，点 ▶ 运行',
    ['taskTemplates'],
    688,
    '0.9.2',
    '2026-09-28T08:00:00Z',
    'Gr',
    '#02303a',
  ),
  item(
    'pixelsky.lua',
    'Lua 支持',
    'pixelsky',
    true,
    'Lua 5.4 / LuaJIT 语法高亮和片段',
    ['grammars', 'snippets'],
    612,
    '1.1.0',
    '2026-10-03T08:00:00Z',
    'Lua',
    '#2c2d72',
  ),
  item(
    'acme.docker-snippets',
    'Docker 片段',
    'acme',
    false,
    'Dockerfile 和 compose 常用片段',
    ['snippets'],
    540,
    '1.0.0',
    '2026-09-20T08:00:00Z',
    'Dk',
    '#1d63ed',
  ),
  item(
    'dracula.theme',
    'Dracula',
    'dracula',
    false,
    '经典紫色暗色主题',
    ['themes'],
    531,
    '3.1.0',
    '2026-09-11T08:00:00Z',
    'Dr',
    '#44475a',
  ),
  item(
    'pixelsky.kotlin',
    'Kotlin 支持',
    'pixelsky',
    true,
    'Kotlin / Kotlin Script 语法高亮和片段',
    ['grammars', 'snippets'],
    498,
    '1.0.4',
    '2026-10-06T08:00:00Z',
    'Kt',
    '#7f52ff',
  ),
  item(
    'lin.commit-prompts',
    '提交信息提示词',
    'lin',
    false,
    '按约定式提交（Conventional Commits）写提交信息的提示词',
    ['prompts'],
    377,
    '1.2.0',
    '2026-10-10T08:00:00Z',
    '提',
    '#c2602b',
  ),
  item(
    'hao.go-tasks',
    'Go 任务',
    'hao',
    false,
    'go build / test / vet 一键运行',
    ['taskTemplates'],
    301,
    '0.4.1',
    '2026-08-30T08:00:00Z',
    'Go',
    '#00a7d0',
  ),
  item(
    'sora.solarized',
    'Solarized',
    'sora',
    false,
    '浅色和深色两套 Solarized 配色',
    ['themes'],
    280,
    '1.5.0',
    '2026-07-19T08:00:00Z',
    'So',
    '#b58900',
  ),
  item(
    'wen.sql-skills',
    'SQL 优化技能',
    'wen',
    false,
    '让 AI 分析慢查询、给出索引建议',
    ['skills', 'prompts'],
    222,
    '0.8.0',
    '2026-10-08T08:00:00Z',
    'SQ',
    '#5b6ee1',
  ),
]

/** 演示里已经装好的（发现页显示「已安装」；其中有新版本的显示「更新」） */
const INSTALLED = ['pixelsky.vue', 'acme.docker-snippets']
const UPDATES: ExtStoreUpdates = { 'acme.docker-snippets': { latest: '1.1.0', engineOk: true } }

const GROUP_KINDS: Record<string, string[]> = {
  code: ['grammars', 'themes', 'snippets', 'iconThemes', 'taskTemplates'],
  ai: ['skills', 'prompts'],
}

function catalog(q = '', category = '', sort = 'recommended', before: string | null = null): ExtStoreCatalogPage {
  const text = q.trim().toLowerCase()
  const kinds = category ? (GROUP_KINDS[category] ?? [category]) : null
  let list = ITEMS.filter(
    i =>
      (!text || [i.id, i.name, i.description, i.publisher.name].join('\n').toLowerCase().includes(text)) &&
      (!kinds || i.kinds.some(k => kinds.includes(k))),
  )
  if (sort === 'downloads') list = [...list].sort((a, b) => b.downloads - a.downloads)
  else if (sort === 'newest') list = [...list].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  const offset = Math.max(0, Number(before) || 0)
  const items = list.slice(offset, offset + PAGE)
  return { items, nextBefore: offset + PAGE < list.length ? String(offset + PAGE) : null }
}

const unsupported = (): never => {
  throw new Error('演示模式下没有这个功能')
}

const bridge: ExtStoreBridge = {
  catalog: async query => {
    await new Promise(r => setTimeout(r, 120))
    return catalog(query.q, query.category, query.sort, query.before)
  },
  detail: async () => null,
  install: async () => unsupported(),
  cancel: async () => {},
  checkUpdates: async () => UPDATES,
  state: async () => ({ site: 'https://demo.pixelsky.test', updates: UPDATES, blocklistAt: null, installing: {} }),
  refreshBlocklist: async () => ({ blocklistAt: null }),
  report: async () => unsupported(),
  publisher: async () => ({ publisher: null, extensions: [] }),
  register: async () => unsupported(),
  pickUpload: async () => null,
  upload: async () => unsupported(),
  withdraw: async () => unsupported(),
  delist: async () => unsupported(),
  relist: async () => unsupported(),
  publishCheck: async () => null,
  onChange: () => () => {},
}

export const demoExtStore: DemoSource['extStore'] = { bridge, installed: INSTALLED }
