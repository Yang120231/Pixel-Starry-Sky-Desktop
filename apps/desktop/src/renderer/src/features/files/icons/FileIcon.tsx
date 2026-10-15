import { useState, type JSX } from 'react'
import { File, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/ui'
import { useFileIconResolver } from './store'

/** 文件 / 文件夹图标：当前图标主题有对应的就画主题的 SVG，否则退回单色线条图标 */
export function FileIcon({
  name,
  kind,
  expanded = false,
  root = false,
  size = 14,
  dim = false,
  className,
}: {
  name: string
  kind: 'file' | 'directory'
  expanded?: boolean
  /** 项目根文件夹行：用主题的根文件夹图标 */
  root?: boolean
  size?: number
  /** 被 .gitignore 忽略的：图标 45% 不透明 */
  dim?: boolean
  className?: string
}): JSX.Element {
  const resolver = useFileIconResolver()
  const src = resolver ? (kind === 'directory' ? resolver.folder(name, expanded, root) : resolver.file(name)) : null
  // 图标文件缺失（404）时退回线条图标；src 变了（换主题）会重新尝试
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (src && src !== failedSrc) {
    return (
      <img
        alt=""
        aria-hidden
        draggable={false}
        width={size}
        height={size}
        src={src}
        onError={() => setFailedSrc(src)}
        className={cn('shrink-0 select-none', dim && 'opacity-45', className)}
      />
    )
  }
  const Icon = kind === 'directory' ? (expanded ? FolderOpen : Folder) : File
  // 调用方自己给了文字色（如项目根行的主色）就不再加默认的灰色
  return (
    <Icon
      size={size}
      className={cn('shrink-0', !className?.includes('text-') && 'text-fg-muted', dim && 'opacity-45', className)}
    />
  )
}
