// 工作台原来的演示会话也用真实对话组件显示（docs/ui/demo-conversation.md §8）。
// 内容和演示里别处对得上：全局搜索演示结果（mock/search.ts）、任务 › 待处理（mock/inbox.ts）、产物面板（mock/artifacts.ts）。
import type { FileChange, Item, SessionSnapshot } from '@pixelsky/protocol'
import { demo } from './demo'
import { DEMO_FILES } from './files'
import {
  ESC,
  MIN,
  T0,
  assistant,
  change,
  failed,
  numbered,
  opus,
  reasoning,
  sessionRecord,
  snapshot,
  stats,
  user,
} from './conversations'

const HOUR = 60 * MIN
const DAY = 24 * HOUR

const read = (id: string, title: string, output = '', subagent?: string): Item => ({
  kind: 'tool',
  id,
  tool: 'read',
  name: 'Read',
  title,
  output,
  status: 'completed',
  ...(subagent ? { subagent } : {}),
})
const search = (id: string, name: 'Grep' | 'Glob', title: string, output: string): Item => ({
  kind: 'tool',
  id,
  tool: 'search',
  name,
  title,
  output,
  status: 'completed',
})
const run = (
  id: string,
  command: string,
  description: string,
  output: string,
  status: 'completed' | 'failed' | 'running' = 'completed',
): Item => ({
  kind: 'command',
  id,
  command,
  description,
  output,
  exitCode: status === 'completed' ? 0 : status === 'failed' ? 1 : null,
  status,
})
const edits = (id: string, changes: FileChange[]): Item => ({ kind: 'file_change', id, changes, status: 'completed' })
const added = (lines: string[]): string[] => [`@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => '+' + l)]

const BUILD_OUTPUT = [
  '> pixel-web@0.1.0 build',
  '> vite build',
  '',
  `${ESC}36mvite v6.3.5 ${ESC}32mbuilding for production...${ESC}39m`,
  `${ESC}32m✓${ESC}39m 412 modules transformed.`,
  `${ESC}2mdist/${ESC}22m${ESC}32mindex.html                 ${ESC}39m${ESC}1m${ESC}2m  0.46 kB${ESC}22m`,
  `${ESC}2mdist/${ESC}22m${ESC}35massets/index-C8f2a1.css   ${ESC}39m${ESC}1m${ESC}2m 18.92 kB${ESC}22m`,
  `${ESC}2mdist/${ESC}22m${ESC}36massets/index-D41b9e.js    ${ESC}39m${ESC}1m${ESC}2m214.07 kB${ESC}22m`,
  `${ESC}32m✓ built in 2.21s${ESC}39m`,
].join('\n')

// ---------- 「hhh」= 参考图那一轮（条目 id 沿用全局搜索演示结果） ----------

function hhh(): SessionSnapshot {
  const reply = demo.assistantReply!
  const text = [
    reply.intro,
    '',
    ...reply.bullets.map(b => `- ${b.text}${b.bold ? `**${b.bold}**` : ''}${b.after ?? ''}`),
    '',
    reply.outro,
  ].join('\n')
  const [composer, css] = demo.changedFiles!.files
  const path = (f: typeof composer): string => f.dir + f.name
  return snapshot(sessionRecord('s-hhh', 'hhh', 'pixel-web', { createdAt: T0 - 3 * MIN, updatedAt: T0 - MIN }), [
    user('hhh-u1', '按参考图把会话页的输入框和改动卡片调一下，改完跑一遍构建', 3),
    reasoning(
      'hhh-r1',
      '先看 Composer 现在的结构和样式，再按参考图改：附件标签放输入框里，发送按钮圆形，外框圆角加大。',
    ),
    read('hhh-t1', path(composer), numbered(DEMO_FILES['src/session/Composer.jsx'])),
    ...composer.diffs!.map((diff, i) => edits(`hhh-f${i + 1}`, [{ ...countDiff(diff), path: path(composer) }])),
    edits('demo-tool-0', [{ ...countDiff(css.diffs![0]), path: path(css) }]),
    run('demo-tool-1', 'npm run build', '构建一遍确认没有告警', BUILD_OUTPUT),
    assistant('demo-assistant', text),
    stats('hhh-s1', 'completed', demo.turnUsage!),
  ])
}

function countDiff(diff: string): Omit<FileChange, 'path'> {
  const lines = diff.split('\n')
  return {
    kind: 'update',
    diff,
    added: lines.filter(l => l.startsWith('+')).length,
    removed: lines.filter(l => l.startsWith('-')).length,
  }
}

// ---------- 「重构网页版工作台为 Codex 式布局」= 待处理里失败的那条，平台会话 ----------

export const SIDEBAR_CHANGES = [
  change('src/sidebar/Sidebar.tsx', 'update', [
    '@@ -1,14 +1,22 @@',
    "-import { ProjectList } from './ProjectList'",
    "+import { ProjectList } from './ProjectList'",
    "+import { RecentList } from './RecentList'",
    "+import { AccountRow } from './AccountRow'",
    ' ',
    ' export function Sidebar({ projects, recent, account }) {',
    '   return (',
    '-    <aside className="sidebar">',
    '+    <aside className="sidebar flex flex-col">',
    '       <ProjectList projects={projects} />',
    '-      <div className="recent">{recent.map(r => <a key={r.id}>{r.title}</a>)}</div>',
    '-      <footer>{account.name}</footer>',
    '+      <div className="flex-1" />',
    '+      <RecentList items={recent} />',
    '+      <AccountRow account={account} />',
    '     </aside>',
    '   )',
    ' }',
  ]),
  change('src/sidebar/RecentList.tsx', 'update', [
    '@@ -3,6 +3,8 @@',
    ' export function RecentList({ items }) {',
    '+  if (items.length === 0) return null',
    '   return (',
    '-    <ul>',
    '+    <ul className="recent" aria-label="最近任务">',
    '       {items.map(item => (',
    '         <li key={item.id}>{item.title}</li>',
  ]),
]

const REPORT = [
  '# 侧栏改版报告',
  '',
  '## 改了什么',
  '',
  '- 「最近任务」固定在账号行上方',
  '- 会话状态点统一为 6px',
  '',
  '## 验证',
  '',
  '| 项目 | 结果 |',
  '|---|---|',
  '| 构建 | 通过 |',
  '| 键盘导航 | 通过 |',
]

function redesign(id: string): SessionSnapshot {
  const balance = '额度不足：当前分组余额为 0，请充值或切换线路后重试'
  return snapshot(
    sessionRecord(id, '重构网页版工作台为 Codex 式布局', 'pixel-web', {
      platform: { groupId: '11', account: 'linxia@example.com' },
      createdAt: T0 - 27 * HOUR,
      updatedAt: T0 - 18 * MIN,
      lastOutcome: 'failed',
      lastError: balance,
    }),
    [
      user('demo-u1', '帮我看一下侧栏改版的整体结构', 27 * 60),
      reasoning(
        'rd-r1',
        '先读侧栏现在的组件，看「最近任务」和账号行在哪里，再按 Codex 的布局调整：最近任务放到账号行上方。',
      ),
      read('rd-t1', 'src/sidebar/Sidebar.tsx'),
      read('rd-t2', 'src/sidebar/RecentList.tsx'),
      search('rd-t3', 'Grep', 'recent · src/sidebar', 'src/sidebar/Sidebar.tsx\nsrc/sidebar/RecentList.tsx'),
      assistant('rd-a1', '结构清楚了：最近任务直接写在 Sidebar 里，账号行没有单独的组件。拆出来再调位置。'),
      edits('demo-c1', SIDEBAR_CHANGES),
      edits('demo-d4', [change('preview/sidebar.html', 'add', added(['<!doctype html>', '<div id="root"></div>']))]),
      run('rd-c1', 'npm run build', '构建', BUILD_OUTPUT),
      edits('demo-d1', [change('docs/侧栏改版报告.md', 'add', added(REPORT))]),
      assistant(
        'rd-a2',
        '侧栏改好了，报告在 `docs/侧栏改版报告.md`：\n\n- 「最近任务」拆成 `RecentList`，固定在账号行上方；\n- 账号行单独成 `AccountRow`；\n- 构建通过。\n\n预览页 `preview/sidebar.html` 只是临时看效果的，确认后可以删掉。',
      ),
      stats('rd-s1', 'completed', {
        durationMs: 142_000,
        settlement: {
          account: 'linxia@example.com',
          requests: [{ id: 'pixelsky-demo-rd', model: 'claude-opus-5-5', groupId: '11' }],
          startedAt: T0 - 27 * HOUR,
          complete: true,
        },
        models: { 'claude-opus-5-5': { ...opus(8_200, 2_400, 0.3184, 9), costSource: 'platform', billing: 'balance' } },
      }),
      user('rd-u2', '最近任务再加一个按项目分组的开关', 18),
      {
        kind: 'notice',
        id: 'rd-n1',
        level: 'error',
        text: balance,
        detail: 'HTTP 402\ninsufficient_balance: 余额 $0.00',
      },
      failed('rd-s2'),
    ],
  )
}

// ---------- 「设置页迁移到新的表单组件」= 待处理里等你确认的那条 ----------

export const SETTINGS_CHANGES = {
  account: change('src/settings/AccountForm.tsx', 'update', [
    '@@ -1,8 +1,9 @@',
    "-import { useState } from 'react'",
    "+import { useField } from './fields/useField'",
    ' ',
    ' export function AccountForm() {',
    "-  const [email, setEmail] = useState('')",
    "+  const email = useField('', v => (v.includes('@') ? null : '请输入有效的邮箱'))",
    '   return (',
    '-    <input value={email} onChange={e => setEmail(e.target.value)} />',
    '+    <input {...email.props} />',
    '+    {email.error && <p className="error">{email.error}</p>}',
  ]),
  useField: change(
    'src/settings/fields/useField.ts',
    'add',
    added([
      "import { useState } from 'react'",
      '',
      '/** 一个表单字段：值、校验结果、绑定到输入框的属性 */',
      'export function useField(initial: string, validate: (value: string) => string | null) {',
      '  const [value, setValue] = useState(initial)',
      '  const [touched, setTouched] = useState(false)',
      '  const error = touched ? validate(value) : null',
      '  return {',
      '    value,',
      '    error,',
      '    props: {',
      '      value,',
      '      onChange: (e: { target: { value: string } }) => setValue(e.target.value),',
      '      onBlur: () => setTouched(true),',
      "      'aria-invalid': !!error,",
      '    },',
      '  }',
      '}',
    ]),
  ),
  oldForm: change('src/legacy/OldForm.tsx', 'delete', [
    '@@ -1,9 +0,0 @@',
    '-// 旧的表单组件，迁移完删掉',
    '-export function OldForm({ fields, onSubmit }) {',
    '-  return (',
    '-    <form onSubmit={onSubmit}>',
    '-      {fields.map(f => <input key={f.name} name={f.name} />)}',
    '-      <button type="submit">保存</button>',
    '-    </form>',
    '-  )',
    '-}',
  ]),
}

const TEST_COMMAND = 'pnpm test --filter settings'

function settingsForm(): SessionSnapshot {
  const turnId = 'sf-turn-2'
  return snapshot(
    sessionRecord('s-settings-form', '设置页迁移到新的表单组件', 'pixel-web', {
      createdAt: T0 - 45 * MIN,
      updatedAt: T0 - 2 * MIN,
      permissionMode: 'ask',
    }),
    [
      user('sf-u1', '先列一下设置页有哪些表单要迁', 44),
      search(
        'sf-t1',
        'Glob',
        'src/settings/**/*Form.tsx',
        'src/settings/AccountForm.tsx\nsrc/settings/AppearanceForm.tsx\nsrc/settings/NotifyForm.tsx',
      ),
      search(
        'sf-t2',
        'Grep',
        'OldForm · src',
        'src/settings/AppearanceForm.tsx\nsrc/settings/NotifyForm.tsx\nsrc/legacy/OldForm.tsx',
      ),
      assistant(
        'sf-a1',
        '要迁的有三个：\n\n| 表单 | 现在用的 | 字段数 |\n| --- | --- | --- |\n| 账号 | `useState` 手写 | 2 |\n| 外观 | `OldForm` | 4 |\n| 通知 | `OldForm` | 6 |\n\n建议先做账号和外观，通知的字段最多，放到后面。',
      ),
      stats('sf-s1', 'completed', { durationMs: 26_000, models: { 'claude-opus-5-5': opus(3_800, 520, 0.0466, 2) } }),
      user('demo-u2', '把设置页迁到新的表单组件，先做账号和外观两页', 25, { turnId }),
      {
        kind: 'todo',
        id: 'sf-todo',
        steps: [
          { text: '写 useField', status: 'completed' },
          { text: '账号表单改用 useField', status: 'completed' },
          { text: '外观表单改用 useField，删掉 OldForm', status: 'completed' },
          { text: '跑设置页的测试', status: 'in_progress' },
        ],
        status: 'completed',
      },
      edits('demo-c2', [SETTINGS_CHANGES.useField, SETTINGS_CHANGES.account]),
      edits('demo-c3', [SETTINGS_CHANGES.oldForm]),
      run(
        'demo-d2',
        'node scripts/capture.mjs --out docs/form-screens.png',
        '截一张两页表单的对照图',
        '已保存 docs/form-screens.png（1280×720）',
      ),
      edits('demo-d3', [
        change(
          'C:/Users/linxia/Desktop/字段对照表.csv',
          'add',
          added(['旧字段,新字段,校验', 'email,email,有效邮箱', 'nickname,displayName,1-32 个字']),
        ),
      ]),
      assistant(
        'sf-a2',
        '账号和外观两页迁好了，对照图在 `docs/form-screens.png`，字段对照表放在你桌面上。跑一下设置页的测试。',
      ),
      run('sf-c-test', TEST_COMMAND, '跑设置页的测试', '', 'running'),
    ],
    {
      state: 'waiting',
      turnId,
      execution: { model: 'claude-opus-5-5', effort: 'high', platform: null },
      pending: [
        {
          requestId: 'demo-req',
          itemId: 'sf-c-test',
          kind: 'command',
          title: '运行命令',
          command: TEST_COMMAND,
          description: '跑设置页的测试',
          alwaysScopes: ['session', 'project', 'user'],
        },
      ],
    },
  )
}

// ---------- 「把云主机配置引导改成两步」= 待处理里队列暂停的那条 ----------

function cloudOnboarding(): SessionSnapshot {
  const queued = (id: string, text: string, minutesAgo: number) => ({
    id,
    text,
    createdAt: T0 - 3 * DAY - minutesAgo * MIN,
    settings: { model: 'claude-opus-5-5', effort: 'high' as const, platform: null },
    status: 'queued' as const,
    error: null,
    mode: 'normal' as const,
  })
  return snapshot(
    sessionRecord('s-cloud-onboarding', '把云主机配置引导改成两步', 'pixel-web', {
      createdAt: T0 - 3 * DAY - 40 * MIN,
      updatedAt: T0 - 3 * DAY,
    }),
    [
      user('co-u1', '云主机配置引导现在五步太长了，改成两步：先选机器，再确认', 3 * 24 * 60 + 40),
      read('co-t1', 'src/cloud/OnboardingWizard.tsx'),
      edits('co-f1', [
        change('src/cloud/OnboardingWizard.tsx', 'update', [
          '@@ -4,9 +4,6 @@',
          ' const STEPS = [',
          "-  { id: 'region', title: '选择地区' },",
          "-  { id: 'size', title: '选择规格' },",
          "-  { id: 'image', title: '选择镜像' },",
          "-  { id: 'network', title: '网络设置' },",
          "-  { id: 'confirm', title: '确认' },",
          "+  { id: 'machine', title: '选择机器' },",
          "+  { id: 'confirm', title: '确认并创建' },",
          ' ]',
        ]),
      ]),
      run(
        'co-c1',
        'npm test -- src/cloud',
        '跑引导的测试',
        `${ESC}32m✓${ESC}39m src/cloud/OnboardingWizard.test.tsx ${ESC}2m(6 tests)${ESC}22m`,
      ),
      assistant(
        'co-a1',
        '改成两步了：第一步选机器（地区、规格、镜像放在一页里，有推荐默认值），第二步确认并创建。网络设置用默认值，放进「高级」折叠里。测试 6 个全部通过。',
      ),
      stats('co-s1', 'completed', { durationMs: 74_000, models: { 'claude-opus-5-5': opus(5_100, 980, 0.0712, 4) } }),
    ],
    {
      queuePaused: true,
      queue: [queued('co-q1', '顺便把第二步的说明文字改短', 20), queued('co-q2', '改完截一张图给我看看', 18)],
    },
  )
}

// ---------- 已归档、最近任务里的会话 ----------

function archived(): SessionSnapshot {
  return snapshot(
    sessionRecord('s-archived-demo', '已完成的项目检查', 'pixel-web', {
      archivedAt: T0 - 5 * DAY,
      createdAt: T0 - 5 * DAY - 20 * MIN,
      updatedAt: T0 - 5 * DAY,
    }),
    [
      user('ar-u1', '检查一下项目还有没有 lint、类型和测试问题', 5 * 24 * 60 + 20),
      run('ar-c1', 'npm run lint', '检查代码风格', `${ESC}32m✔ No problems found${ESC}39m`),
      run('ar-c2', 'npx tsc --noEmit', '类型检查', ''),
      run(
        'ar-c3',
        'npm test',
        '跑全部测试',
        `${ESC}2m Test Files ${ESC}22m ${ESC}1m${ESC}32m14 passed${ESC}39m${ESC}22m\n${ESC}2m      Tests ${ESC}22m ${ESC}1m${ESC}32m86 passed${ESC}39m${ESC}22m`,
      ),
      assistant('ar-a1', '都没问题：lint 0 个问题，类型检查通过，测试 14 个文件 86 个全部通过。'),
      stats('ar-s1', 'completed', { durationMs: 51_000, models: { 'claude-opus-5-5': opus(2_200, 210, 0.0254, 3) } }),
    ],
  )
}

function cloudReconnect(): SessionSnapshot {
  return snapshot(
    sessionRecord('r-cloud-reconnect', '修复云主机断线后仍显示已连接', 'pixel-desktop', { updatedAt: T0 - MIN }),
    [
      user('cr-u1', '云主机断线以后侧栏还一直显示「已连接」', 6),
      read('cr-t1', 'src/machines/status.ts'),
      edits('cr-f1', [
        change('src/machines/status.ts', 'update', [
          '@@ -12,4 +12,7 @@',
          '   socket.on("close", () => {',
          '-    // TODO',
          "+    setStatus(machine.id, 'disconnected')",
          '+    scheduleReconnect(machine.id)',
          '+  })',
          '+  socket.on("error", () => {',
          "+    setStatus(machine.id, 'disconnected')",
          '   })',
        ]),
      ]),
      run(
        'cr-c1',
        'npm test -- src/machines',
        '跑连接状态的测试',
        `${ESC}32m✓${ESC}39m src/machines/status.test.ts ${ESC}2m(4 tests)${ESC}22m`,
      ),
      assistant(
        'cr-a1',
        '原因是连接关闭时没有更新状态。现在 `close` 和 `error` 都会标成「已断开」，并自动重连；测试 4 个通过。',
      ),
      stats('cr-s1', 'completed', { durationMs: 38_000, models: { 'claude-opus-5-5': opus(3_300, 410, 0.0389, 3) } }),
    ],
  )
}

function channelQuote(): SessionSnapshot {
  return snapshot(sessionRecord('r-channel-quote', '频道话题支持引用回复', 'pixel-channel', { updatedAt: T0 - HOUR }), [
    user('cq-u1', '频道话题里加上引用回复：回复时显示被引用的那条，点了能跳过去', 70),
    edits('cq-f1', [
      change('src/topic/Message.tsx', 'update', [
        '@@ -8,3 +8,8 @@',
        '   return (',
        '     <article className="message">',
        '+      {message.replyTo && (',
        '+        <button className="quote" onClick={() => jumpTo(message.replyTo.id)}>',
        '+          {message.replyTo.author}：{message.replyTo.preview}',
        '+        </button>',
        '+      )}',
      ]),
    ]),
    run('cq-c1', 'gh pr create --fill', '开 PR', 'https://github.com/pixel/pixel-channel/pull/42'),
    assistant(
      'cq-a1',
      '加好了，回复时消息上方显示被引用的那条，点了跳过去。PR：https://github.com/pixel/pixel-channel/pull/42',
    ),
    stats('cq-s1', 'completed', { durationMs: 63_000, models: { 'claude-opus-5-5': opus(4_400, 760, 0.0581, 3) } }),
  ])
}

function changelog(): SessionSnapshot {
  return snapshot(sessionRecord('r-changelog', '整理 10 月更新日志', 'docs-site', { updatedAt: T0 - 3 * HOUR }), [
    user('cl-u1', '按这个月的提交整理一份 10 月更新日志', 190),
    run(
      'cl-c1',
      'git log --since=2026-10-01 --oneline',
      '看这个月的提交',
      'a41f0c2 输入框支持粘贴图片\n93be1d7 会话页拆出 Composer\n7d2e110 云主机引导改成两步\n5c02e88 频道话题支持引用回复',
    ),
    edits('cl-f1', [
      change(
        'docs/changelog/2026-10.md',
        'add',
        added(['# 10 月更新', '', '- 输入框支持粘贴图片', '- 云主机配置引导改成两步', '- 频道话题支持引用回复']),
      ),
    ]),
    assistant('cl-a1', '整理好了，写在 `docs/changelog/2026-10.md`，按用户能感知的改动列了三条，内部重构没有写进去。'),
    stats('cl-s1', 'completed', { durationMs: 29_000, models: { 'claude-opus-5-5': opus(2_600, 330, 0.0302, 2) } }),
  ])
}

export const workbenchSnapshots: Record<string, SessionSnapshot> = Object.fromEntries(
  [
    hhh(),
    redesign('s-redesign'),
    settingsForm(),
    cloudOnboarding(),
    archived(),
    cloudReconnect(),
    channelQuote(),
    changelog(),
  ].map(s => [s.record.id, s]),
)
