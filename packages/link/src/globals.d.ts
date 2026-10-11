// 包里只用到这几个各平台都有的全局对象；不引入 DOM 或 Node 的类型，免得用到某一边独有的接口
declare class TextEncoder {
  encode(input?: string): Uint8Array
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean })
  decode(input?: Uint8Array): string
}
declare function setTimeout(handler: (...args: never[]) => void, ms?: number): unknown
declare function queueMicrotask(callback: () => void): void
declare function clearTimeout(handle: unknown): void
