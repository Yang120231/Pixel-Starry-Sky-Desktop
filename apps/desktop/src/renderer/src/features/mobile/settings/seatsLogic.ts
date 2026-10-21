// 设置 › 手机的设备列表（docs/cloud-admin-seats-plan.md §3）：本机配对的手机（有权限、指纹）和云端列出的账号下所有网页设备
// 合成一张表。云端旧版本没有设备接口时只有本机的。
import type { MobileCloudDevice, MobileDevice, MobileSeats } from '../../../../../shared/types/mobile'

/** 每台电脑最多配对的手机数（主进程 store.ts 的 MAX_DEVICES，云端同样的上限）；和账号的远程席位分开算 */
export const MAX_PAIRED = 5

export interface DeviceRow {
  id: string
  name: string
  /** 本机配对记录（能设权限、走 mobile:revoke）；其它电脑配对的为 null */
  device: MobileDevice | null
  /** 云端的记录（最近 IP、所属电脑）；云端旧版本或云端没有这条时为 null */
  cloud: MobileCloudDevice | null
  /** 配在这台电脑上 */
  local: boolean
  online: boolean
  lastSeenAt: number | null
}

export function deviceRows(devices: MobileDevice[], seats: MobileSeats | null): DeviceRow[] {
  const cloud = seats?.available ? seats.devices : []
  const byId = new Map(cloud.map(c => [c.id, c]))
  const rows: DeviceRow[] = devices.map(d => {
    const c = byId.get(d.id) ?? null
    return {
      id: d.id,
      name: d.name || c?.name || d.id,
      device: d,
      cloud: c,
      local: true,
      online: d.online || !!c?.online,
      lastSeenAt: Math.max(d.lastSeenAt ?? 0, c?.lastSeenAt ?? 0) || null,
    }
  })
  const known = new Set(devices.map(d => d.id))
  for (const c of cloud) {
    if (known.has(c.id)) continue
    rows.push({
      id: c.id,
      name: c.name || c.id,
      device: null,
      cloud: c,
      local: c.local,
      online: c.online,
      lastSeenAt: c.lastSeenAt,
    })
  }
  return rows
}

/** 电脑 ID 的短写（其它电脑只有 ID，没有名字） */
export const shortDesktop = (id: string): string => id.replace(/-/g, '').slice(0, 8) || '?'
