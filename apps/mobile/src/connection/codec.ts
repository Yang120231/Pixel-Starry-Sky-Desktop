// 加密通道的压缩：浏览器自带的 CompressionStream（deflate-raw），和电脑端的 zlib 互通（M0 核对过）。
import type { Codec } from '@pixelsky/link'

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, max = Infinity) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      await reader.cancel()
      throw new Error('LINK_FRAME_TOO_LARGE')
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export const browserCodec: Codec = {
  deflate: bytes => pipe(bytes, new CompressionStream('deflate-raw')),
  inflate: (bytes, maxBytes) => pipe(bytes, new DecompressionStream('deflate-raw'), maxBytes),
}
