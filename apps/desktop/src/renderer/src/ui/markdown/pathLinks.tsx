// 正文里的文件路径链接（docs/ui/content-highlight.md §2 A、F）。这里只定义接口和显示：
// 判断文件是否存在、怎么打开由 features/files/PathLinksProvider.tsx 注入（ui/ 不读文件）。
import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { defaultUrlTransform } from 'react-markdown'
import { cn } from '@/ui'

export interface PathTarget {
  /** 相对项目根目录，用 / 分隔 */
  path: string
  line: number | null
  column: number | null
}

export interface PathLinks {
  /** 一段文字恰好是项目里存在的文件（可带 :行 / :行:列）时给出目标，否则 null */
  resolve(text: string): Promise<PathTarget | null>
  open(target: PathTarget): void
}

/** 没有提供时（频道、产物预览、演示模式）不加链接 */
export const PathLinksContext = createContext<PathLinks | null>(null)

/** 先排除明显不是路径的文字（有空白、没有扩展名、太长），免得每段行内代码都去读盘 */
export function maybePath(text: string): boolean {
  const t = text.trim()
  return (
    t.length > 2 &&
    t.length <= 260 &&
    !/\s/.test(t) &&
    /\.[A-Za-z]\w{0,9}(?::\d+(?::\d+)?|\(\d+(?:,\s*\d+)?\))?$/.test(t)
  )
}

/**
 * Markdown 链接地址里的本地文件 → 「路径:行:列」形式的文字；网址、页内锚点返回 null。
 * 支持 src/a.ts、./a.ts#L12、a.ts#L12C3、a.ts#L10-L20、file:///D:/x/a.ts。
 */
export function linkPathText(href: string | undefined): string | null {
  if (!href || href.startsWith('#') || href.startsWith('//')) return null
  let value = href
  if (/^file:/i.test(value)) value = value.replace(/^file:\/*/i, /^file:\/*[A-Za-z]:/i.test(value) ? '' : '/')
  else if (/^[a-z][\w+.-]*:/i.test(value) && !DRIVE.test(value)) return null
  const [rawPath, hash = ''] = value.split('#', 2)
  let path: string
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    path = rawPath
  }
  if (!path) return null
  const lines = /^L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/.exec(hash)
  if (lines) return `${path}:${lines[1]}${lines[2] ? `:${lines[2]}` : ''}`
  return path
}

/**
 * Markdown 链接地址的过滤（react-markdown 的 urlTransform）：默认只放行 http、https、mailto 等，
 * `D:\a\b.png` 会被当成 D: 协议、`file:///` 不认，地址被清空，链接点了没反应。
 * 本地路径原样留下（是项目里的文件时在软件里打开，见 MarkdownLink），其余仍按默认过滤。
 * 解析 Markdown 时地址里的 \ 已经转成 %5C（D:%5Ca%5Cb.png），两种写法都认
 */
export function keepLocalPaths(url: string): string {
  return DRIVE.test(url) || /^file:/i.test(url) ? url : defaultUrlTransform(url)
}

/** 盘符开头的 Windows 路径：D:\、D:/，或转义过的 D:%5C */
const DRIVE = /^[A-Za-z]:(?:[\\/]|%5C)/i

/** 本地路径（盘符、file:、/ 开头的绝对路径）：不是项目里的文件时不交给浏览器打开 */
const isLocalHref = (href: string): boolean => DRIVE.test(href) || /^(?:file:|\/(?!\/))/i.test(href)

/** 提示里显示的路径：把 %5C、中文等转义还原 */
const readable = (href: string): string => {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

/** 文字对应项目里存在的文件时返回目标；还在查、不是路径或没有上下文时为 null */
export function usePathTarget(text: string | null): PathTarget | null {
  const links = useContext(PathLinksContext)
  const [found, setFound] = useState<{ text: string; target: PathTarget | null } | null>(null)
  useEffect(() => {
    if (!links || !text || !maybePath(text)) return
    let live = true
    links
      .resolve(text)
      .then(target => live && setFound({ text, target }))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [links, text])
  return found && found.text === text ? found.target : null
}

/** 打开文件；没有上下文时为 null */
export function useOpenPath(): ((target: PathTarget) => void) | null {
  return useContext(PathLinksContext)?.open ?? null
}

const targetTitle = (t: PathTarget): string => t.path + (t.line ? `:${t.line}` : '') + (t.column ? `:${t.column}` : '')

/** Markdown 的行内代码：是项目里的文件时变成可点击的路径 */
export function InlineCode({ children, className }: { children?: ReactNode; className?: string }) {
  const text = typeof children === 'string' ? children : null
  const target = usePathTarget(text)
  const open = useOpenPath()
  if (!target || !open) return <code className={className}>{children}</code>
  return (
    <code
      data-path=""
      role="link"
      tabIndex={0}
      title={targetTitle(target)}
      className={cn(className, 'cursor-pointer')}
      onClick={() => open(target)}
      onKeyDown={e => {
        if (e.key === 'Enter') open(target)
      }}
    >
      {children}
    </code>
  )
}

/** Markdown 链接：地址是项目里的文件时在软件里打开，其余交给系统浏览器（主进程只放行 http / https） */
export function MarkdownLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const target = usePathTarget(linkPathText(href))
  const open = useOpenPath()
  if (target && open)
    return (
      <a
        {...rest}
        href={href}
        data-path=""
        title={targetTitle(target)}
        onClick={e => {
          e.preventDefault()
          open(target)
        }}
      >
        {children}
      </a>
    )
  // 本地路径但不是项目里的文件（或还在查）：只显示文字，不当网址打开
  if (href && isLocalHref(href)) return <span title={readable(href)}>{children}</span>
  return (
    <a {...rest} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}
