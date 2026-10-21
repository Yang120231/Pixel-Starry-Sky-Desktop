import { describe, expect, it } from 'vitest'
import type { MobileCloudDevice, MobileDevice, MobileSeats } from '../../../../../shared/types/mobile'
import { deviceRows, shortDesktop } from './seatsLogic'

const local = (id: string, over: Partial<MobileDevice> = {}): MobileDevice => ({
  id,
  name: id,
  fingerprint: 'fp',
  access: 'act',
  pairedAt: 1,
  lastSeenAt: null,
  online: false,
  ...over,
})
const cloud = (id: string, over: Partial<MobileCloudDevice> = {}): MobileCloudDevice => ({
  id,
  name: id,
  desktopId: 'other-desk',
  local: false,
  pending: false,
  online: false,
  lastIp: null,
  lastSeenAt: null,
  createdAt: null,
  ...over,
})
const seats = (devices: MobileCloudDevice[]): MobileSeats => ({
  available: true,
  used: 0,
  limit: 1,
  premium: false,
  seatGroups: [],
  premiumGroups: [],
  devices,
})

describe('deviceRows', () => {
  it('云端旧版本（没有席位接口）：只列本机配对的', () => {
    const rows = deviceRows([local('a')], { available: false })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'a', local: true, cloud: null })
    expect(deviceRows([], null)).toEqual([])
  })

  it('本机的合上云端的 IP 和在线；其它电脑的接在后面', () => {
    const rows = deviceRows(
      [local('a', { lastSeenAt: 100 })],
      seats([
        cloud('a', { local: true, desktopId: 'me', online: true, lastIp: '1.2.3.4', lastSeenAt: 50 }),
        cloud('b', { online: false, lastSeenAt: 200 }),
      ]),
    )
    expect(rows.map(r => [r.id, r.local, r.online, r.lastSeenAt, r.cloud?.lastIp ?? null, !!r.device])).toEqual([
      ['a', true, true, 100, '1.2.3.4', true],
      ['b', false, false, 200, null, false],
    ])
  })

  it('云端有、本机没有记录的本机设备（比如等确认的）：标本机但没有权限设置', () => {
    const [row] = deviceRows([], seats([cloud('p', { local: true, pending: true })]))
    expect(row).toMatchObject({ id: 'p', local: true, device: null })
  })
})

it('shortDesktop', () => {
  expect(shortDesktop('0f3a9c12-aaaa-bbbb')).toBe('0f3a9c12')
  expect(shortDesktop('')).toBe('?')
})
