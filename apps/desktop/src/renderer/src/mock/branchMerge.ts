// 演示：开分支 / 合并回主会话（docs/ui/branch-merge.md）。主会话里有一张合并卡片、等着带给 AI 的摘要；
// 一个还在副本里改的分支（横条、「分支从这里开始」），一个合并后删了副本的分支（只能回看）
import type { Item, SessionSnapshot } from '@pixelsky/protocol'
import { MIN, T0, assistant, change, opus, sessionRecord, snapshot, stats, user } from './conversations'

const MAIN = 'demo-branch-main'
const ACTIVE = 'demo-branch-active'
const DONE = 'demo-branch-done'
const MAIN_TITLE = '登录页改成邮箱 + 验证码'

const edits = (id: string, changes: ReturnType<typeof change>[]): Item => ({
  kind: 'file_change',
  id,
  changes,
  status: 'completed',
})

/** 主会话和两个分支都带过去的前两轮 */
const shared: Item[] = [
  user('bm-u1', '登录页改成邮箱 + 验证码，去掉密码登录', 60),
  assistant('bm-a1', '好的，改成输入邮箱 → 发验证码 → 填 6 位码登录，密码框去掉了。'),
  edits('bm-c1', [
    change('src/pages/Login.tsx', 'update', [
      '@@ -12,6 +12,9 @@',
      '-  <PasswordInput />',
      '+  <EmailInput />',
      '+  <CodeInput length={6} />',
    ]),
  ]),
  stats('bm-s1', 'completed', { durationMs: 41_000, models: { 'claude-opus-5-5': opus(4_200, 610, 0.051, 2) } }),
  user('bm-u2', '验证码输错 3 次锁 10 分钟', 52),
  assistant('bm-a2', '加上了，锁定期间按钮显示剩余时间。'),
  stats('bm-s2', 'completed', { durationMs: 22_000, models: { 'claude-opus-5-5': opus(3_100, 280, 0.031, 1) } }),
]

const branchOf = (copyId: string | null, gitBranch: string | null, extra = {}) => ({
  copyId,
  gitBranch,
  baseBranch: 'main',
  startCommit: copyId ? '3f9a2c1' : null,
  startAfter: 'bm-s2',
  mergedAt: null,
  ...extra,
})

function main(): SessionSnapshot {
  return snapshot(
    sessionRecord(MAIN, MAIN_TITLE, 'pixel-web', {
      createdAt: T0 - 60 * MIN,
      updatedAt: T0 - 5 * MIN,
      pendingMerge: {
        sessionId: DONE,
        title: '先试试短信验证码',
        summary: '分支里做了什么\n· 登录改成短信验证码，手机号用 +86 校验，60 秒倒计时重发',
      },
    }),
    [
      ...shared,
      {
        kind: 'notice',
        id: 'bm-merge',
        level: 'info',
        text: '合并了分支「先试试短信验证码」的代码和结论',
        merge: {
          sessionId: DONE,
          title: '先试试短信验证码',
          summary:
            '分支里做了什么\n· 登录页的「邮箱验证码」改成「短信验证码」，手机号用 +86 校验，60 秒倒计时重发\n· 新增 src/api/sms.ts 调发送接口；auth.ts 去掉邮箱登录分支\n结论和注意\n· 短信接口每个手机号每天限 10 次，前端已经提示；后端限流还没做\n· 邮箱登录入口先保留在「其他方式」里',
          code: 'committed',
          commitMessage: 'feat: 登录页改用短信验证码',
          files: [
            { path: 'src/pages/Login.tsx', status: 'modified', additions: 52, deletions: 24 },
            { path: 'src/api/sms.ts', status: 'added', additions: 31, deletions: 0 },
            { path: 'src/api/auth.ts', status: 'modified', additions: 3, deletions: 7 },
          ],
          copyRemoved: true,
          gitBranch: 'pixelsky/sms-code',
        },
      },
    ],
  )
}

function active(): SessionSnapshot {
  return snapshot(
    sessionRecord(ACTIVE, '邮箱登录挪进「其他方式」', 'pixel-web', {
      cwd: 'D:\\work\\.pixelsky\\worktrees\\pixel-web-3f9a2c1e\\other-login',
      createdAt: T0 - 30 * MIN,
      updatedAt: T0 - 3 * MIN,
      forkedFrom: { sessionId: MAIN, title: MAIN_TITLE },
      branch: branchOf('demo-copy-other', 'pixelsky/other-login'),
    }),
    [
      ...shared,
      user('bm-b-u1', '把邮箱登录挪进「其他方式」折叠区，默认只显示手机号', 20),
      assistant('bm-b-a1', '在副本里改好了：默认只显示手机号，邮箱登录收进「其他方式」，点开再显示。'),
      edits('bm-b-c1', [
        change('src/pages/Login.tsx', 'update', [
          '@@ -30,4 +30,8 @@',
          '+  <Disclosure label="其他方式">',
          '+    <EmailLogin />',
          '+  </Disclosure>',
        ]),
      ]),
      stats('bm-b-s1', 'completed', { durationMs: 33_000, models: { 'claude-opus-5-5': opus(3_600, 420, 0.041, 2) } }),
    ],
  )
}

function done(): SessionSnapshot {
  return snapshot(
    sessionRecord(DONE, '先试试短信验证码', 'pixel-web', {
      cwd: 'D:\\work\\.pixelsky\\worktrees\\pixel-web-3f9a2c1e\\sms-code',
      createdAt: T0 - 45 * MIN,
      updatedAt: T0 - 5 * MIN,
      forkedFrom: { sessionId: MAIN, title: MAIN_TITLE },
      branch: branchOf('demo-copy-sms', 'pixelsky/sms-code', { mergedAt: T0 - 5 * MIN, copyRemoved: true }),
    }),
    [
      ...shared,
      user('bm-d-u1', '换成短信验证码试试，邮箱的先别删', 40),
      assistant('bm-d-a1', '在副本里改：手机号 +86 校验、60 秒倒计时重发；邮箱登录挪到「其他方式」。'),
      stats('bm-d-s1', 'completed', { durationMs: 48_000, models: { 'claude-opus-5-5': opus(5_100, 700, 0.06, 3) } }),
    ],
  )
}

export const branchMergeSnapshots: Record<string, SessionSnapshot> = Object.fromEntries(
  [main(), active(), done()].map(s => [s.record.id, s]),
)

/** 侧栏里的三条：主会话、挂在下面的两个分支 */
export const BRANCH_MERGE_SESSIONS = [
  { id: MAIN, title: MAIN_TITLE, status: 'idle' as const, time: '5分钟' },
  {
    id: ACTIVE,
    title: '邮箱登录挪进「其他方式」',
    status: 'idle' as const,
    time: '3分钟',
    branch: { depth: 1, tag: 'copy' as const },
  },
  {
    id: DONE,
    title: '先试试短信验证码',
    status: 'idle' as const,
    time: '5分钟',
    branch: { depth: 1, tag: 'merged' as const },
  },
]
