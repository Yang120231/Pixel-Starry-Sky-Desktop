// 演示用的云端机器（docs/ui/layout-v2.md §12）：一台已连接、一台已断开，顶栏「本机 | 云端」菜单和截图用
import type { CheckItem, MachineInfo, MachineState, WorkspaceChoice } from '../../../shared/types/machines'
import type { Project } from '@/data/types'

const remote = (
  id: string,
  name: string,
  host: string,
  username: string,
  status: MachineInfo['status'],
): MachineInfo => ({
  id,
  kind: 'ssh',
  name,
  host,
  port: 22,
  username,
  auth: 'agent',
  hasSecret: false,
  status,
  error: null,
  fingerprint: null,
  platform: 'linux',
  home: `/home/${username}`,
})

const ok = (key: CheckItem['key'], detail: string, required = false): CheckItem => ({
  key,
  status: 'ok',
  required,
  detail,
})
const passed: CheckItem[] = [
  ok('start', 'Ubuntu 24.04 · WSL 2', true),
  ok('encoding', 'UTF-8'),
  ok('node', '22.11.0 (~/.nvm/versions/node/v22.11.0/bin/node)', true),
  ok('claude', '2.1.299'),
  ok('codex', '0.16.0'),
  { key: 'login', status: 'ok', required: false, detail: 'claude' },
]
const needsPrep: CheckItem[] = [
  ok('start', 'Debian 12 · WSL 2', true),
  { key: 'encoding', status: 'info', required: false, detail: 'ANSI_X3.4-1968', code: 'ENCODING_NOT_UTF8' },
  {
    key: 'node',
    status: 'fail',
    required: true,
    detail: '18.19.0 (/usr/bin/node)',
    code: 'NODE_OLD',
    fix: 'curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22',
  },
  {
    key: 'claude',
    status: 'warn',
    required: false,
    detail: '/mnt/c/Users/lin/AppData/Roaming/npm/claude',
    code: 'CLAUDE_WINDOWS',
    fix: 'curl -fsSL https://claude.ai/install.sh | bash',
  },
  { key: 'codex', status: 'warn', required: false, detail: '', code: 'CODEX_MISSING', fix: 'npm i -g @openai/codex' },
  { key: 'login', status: 'info', required: false, detail: '' },
]
// 演示用发行版 id：machineOf 只认 十六进制 部分
const WSL_IDS: Record<string, string> = {
  'Ubuntu-24.04': 'wsl-a24c0de24041',
  Debian: 'wsl-de81a2b3c4d5',
  'Ubuntu-22.04': 'wsl-a22c0de22041',
}
const wsl = (
  name: string,
  status: MachineInfo['status'],
  state: 'running' | 'stopped',
  items?: CheckItem[],
): MachineInfo => ({
  id: WSL_IDS[name],
  kind: 'wsl',
  name,
  host: '',
  port: 0,
  username: 'lin',
  auth: 'wsl',
  hasSecret: false,
  status,
  error: null,
  fingerprint: null,
  platform: 'linux',
  home: '/home/lin',
  wsl: {
    distro: name,
    version: 2,
    isDefault: name === 'Ubuntu-24.04',
    state,
    lastCheck: items && { at: Date.now(), items },
  },
})

export const demoMachines: MachineState = {
  currentId: 'local',
  machines: [
    {
      id: 'local',
      kind: 'local',
      name: '',
      host: '',
      port: 0,
      username: '',
      auth: 'local',
      hasSecret: false,
      status: 'local',
      error: null,
      fingerprint: null,
      platform: null,
      home: null,
    },
    wsl('Ubuntu-24.04', 'connected', 'running', passed),
    wsl('Debian', 'disconnected', 'stopped', needsPrep),
    wsl('Ubuntu-22.04', 'disconnected', 'stopped'),
    remote('ssh-demo-dev', 'dev-server', '10.0.0.12', 'ubuntu', 'connected'),
    remote('ssh-demo-gpu', 'gpu-box', 'gpu.example.com', 'root', 'disconnected'),
  ],
}

const UBUNTU = WSL_IDS['Ubuntu-24.04']
const session = (id: string, title: string, time: string): Project['sessions'][number] => ({
  id: `${UBUNTU}~${id}`,
  title,
  status: 'idle',
  time,
})
/** 演示用：WSL · Ubuntu-24.04 里的两个项目（示意图第 3 格），侧栏和「切换工作区」在这台机器上显示它们 */
export const demoMachineProjects: Record<string, Array<Project & { path: string }>> = {
  [UBUNTU]: [
    {
      id: `${UBUNTU}~6f1d2c3a-4b5e-4f60-8a71-0c2d3e4f5a61`,
      name: 'pixel-web',
      path: '~/code/pixel-web',
      branch: 'main',
      expanded: true,
      sessions: [
        session('0a1b2c3d-1111-4222-8333-444455556661', '修复登录页的表单校验', '5分钟'),
        session('0a1b2c3d-1111-4222-8333-444455556662', '给构建脚本加缓存', '2小时'),
      ],
    },
    {
      id: `${UBUNTU}~6f1d2c3a-4b5e-4f60-8a71-0c2d3e4f5a62`,
      name: 'dotfiles',
      path: '~/dotfiles',
      branch: 'main',
      expanded: true,
      sessions: [session('0a1b2c3d-1111-4222-8333-444455556663', '整理 zsh 配置', '昨天')],
    },
  ],
}

/** 演示用的工作区列表（和 demoMachineProjects 对应） */
export const demoMachineWorkspaces = (machineId: string): WorkspaceChoice[] =>
  (demoMachineProjects[machineId] ?? []).map(p => ({
    projectId: p.id,
    name: p.name,
    path: p.path,
    copyId: null,
    branch: p.branch ?? null,
    error: null,
  }))
