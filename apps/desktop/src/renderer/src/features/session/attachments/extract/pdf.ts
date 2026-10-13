// 界面里读 PDF（docs/ui/composer-file-attachments.md §7）：pdf.js 第一次加 PDF 时才加载（约 1.6 MB），解析在它的后台线程里；
// 中文等 CID 字体要的 CMap 跟着应用打包，按名字取（不联网）
import type { FileAttachment } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { documentAttachment } from './document'
import { pdfText, type PdfJs } from './pdfText'

const CMAPS = import.meta.glob<string>('../../../../../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?url',
  import: 'default',
})

/** 给 pdf.js 的 CMap 来源：按文件名找打包好的 */
class BundledData {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const load = kind === 'cMapUrl' ? Object.entries(CMAPS).find(([path]) => path.endsWith(`/${filename}`))?.[1] : null
    if (!load) throw new Error(`${kind} ${filename}`)
    const url = await load()
    // 小的 CMap 被打包成 data: 地址；页面的安全策略不让 fetch data:，直接解码
    if (url.startsWith('data:')) {
      const bin = atob(url.slice(url.indexOf(',') + 1))
      return Uint8Array.from(bin, ch => ch.charCodeAt(0))
    }
    return new Uint8Array(await (await fetch(url)).arrayBuffer())
  }
}

let loading: Promise<PdfJs> | null = null
function pdfjs(): Promise<PdfJs> {
  loading ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib as unknown as PdfJs
    },
  )
  return loading
}

export async function readPdf(file: File): Promise<FileAttachment> {
  let result
  try {
    result = await pdfText(await pdfjs(), new Uint8Array(await file.arrayBuffer()), {
      cMapUrl: 'cmaps/',
      cMapPacked: true,
      useWorkerFetch: false,
      BinaryDataFactory: BundledData,
    })
  } catch {
    throw new Error(tr('composer.file.broken', { p0: file.name }))
  }
  if (result.kind === 'password') throw new Error(tr('composer.file.encrypted', { p0: file.name }))
  if (result.kind === 'scanned') throw new Error(tr('composer.file.scanned', { p0: file.name }))
  return documentAttachment(file, 'pdf', result.text)
}
