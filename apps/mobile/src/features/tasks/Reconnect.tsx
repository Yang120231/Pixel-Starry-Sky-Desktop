// 被别的设备顶掉（中转关闭码 4010，docs/cloud-admin-seats-plan.md §3）：不自动重连，由用户点「重新连接」
import { connections } from '@/connection'
import { Button } from '@/ui'

export const REPLACED_TITLE = '已在其他设备连接'
export const REPLACED_BODY =
  '这个账号同时在线的设备超过了远程席位数，新连上的设备顶掉了这里。点「重新连接」会让那台设备断开；需要同时用可以在电脑的 设置 › 手机 里购买席位。'

export function ReconnectButton({ deviceId, size = 'md' }: { deviceId: string; size?: 'md' | 'sm' }) {
  return (
    <Button variant="primary" size={size} onClick={() => connections.reconnect(deviceId)}>
      重新连接
    </Button>
  )
}
