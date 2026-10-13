// 演示用的云端机器（docs/ui/layout-v2.md §12）：一台已连接、一台已断开，顶栏「本机 | 云端」菜单和截图用
import type { MachineInfo, MachineState } from '../../../shared/types/machines'

const remote = (
  id: string,
  name: string,
  host: string,
  username: string,
  status: MachineInfo['status'],
): MachineInfo => ({
  id,
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

export const demoMachines: MachineState = {
  currentId: 'local',
  machines: [
    {
      id: 'local',
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
    remote('ssh-demo-dev', 'dev-server', '10.0.0.12', 'ubuntu', 'connected'),
    remote('ssh-demo-gpu', 'gpu-box', 'gpu.example.com', 'root', 'disconnected'),
  ],
}
