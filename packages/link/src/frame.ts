// 经中转的帧：第 1 字节是类型，后面是内容（docs/mobile-remote.md §11.3）。
// 中转只按连接转发，看不懂内容；只有配对请求和结果是明文，其余都在加密通道里。
import { concat, fromUtf8, utf8 } from './bytes'

export const FrameType = {
  /** 手机 → 电脑：Noise 握手第一条 */
  Handshake1: 1,
  /** 电脑 → 手机：Noise 握手第二条 */
  Handshake2: 2,
  /** 加密后的数据 */
  Data: 3,
  /** 手机 → 电脑：配对请求（明文 JSON，带用二维码里的密钥算的校验码） */
  Pair: 4,
  /** 电脑 → 手机：配对结果（明文 JSON；不可信，只用来显示，真正的校验是之后的握手） */
  PairResult: 5,
} as const
export type FrameType = (typeof FrameType)[keyof typeof FrameType]

/** 中转的单帧上限是 1 MB；留出加密和帧头的余量 */
export const MAX_FRAME = 1024 * 1024
export const MAX_PAYLOAD = MAX_FRAME - 1024

export function encodeFrame(type: FrameType, body: Uint8Array): Uint8Array {
  if (body.length + 1 > MAX_FRAME) throw new Error('LINK_FRAME_TOO_LARGE')
  return concat(Uint8Array.of(type), body)
}

export function decodeFrame(frame: Uint8Array): { type: FrameType; body: Uint8Array } {
  const type = frame[0]
  if (frame.length < 1 || frame.length > MAX_FRAME || type < 1 || type > 5) throw new Error('LINK_BAD_FRAME')
  return { type: type as FrameType, body: frame.subarray(1) }
}

export const encodeJson = (value: unknown): Uint8Array => utf8(JSON.stringify(value))
export function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(fromUtf8(bytes))
  } catch {
    throw new Error('LINK_BAD_FRAME')
  }
}
