// 正文里的文件路径链接（docs/ui/content-highlight.md §2 A、F）。这里只定义接口和显示：
// 判断文件是否存在、怎么打开由 features/files/PathLinksProvider.tsx 注入（ui/ 不读文件）。
import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { defaultUrlTransform } from 'react-markdown'
import { cn } from '@/ui'
import { pathClickHandlers } from '@/ui/pathClick'

export interface PathTarget {
  /** 相对项目根目录，用 / 分隔 */
  path: string
  line: number | null
  column: number | null
}

/**
 * Markdown 链接指向的本地路径（docs/ui/path-click.md）：项目里的文件、项目里的文件夹（相对项目根目录），
 * 或者项目外、本机上确实存在的路径（完整路径，只能在文件夹中显示，不打开）
 */
export type LinkTarget =
  | ({ kind: 'file' } & PathTarget)
  | { kind: 'folder'; path: string }
  | { kind: 'outside'; path: string; folder: boolean }

export interface PathLinks {
  /** 一段文字恰好是项目里存在的文件（可带 :行 / :行:列）时给出目标，否则 null */
  resolve(text: string): Promise<PathTarget | null>
  open(target: PathTarget): void
  /** 在系统文件管理器里显示（双击 / Shift+Enter）；远程机器等不能显示时为 null（docs/ui/path-click.md） */
  reveal: ((target: PathTarget) => void) | null
  /** 悬停提示：单击 / 双击说明 + 完整路径；kind 是链接指向的东西，不给时是文件 */
  hint(path: string, kind?: LinkTarget['kind']): string
  /**
   * Markdown 链接的地址：地址本身就是明确给出的路径，不套行内代码那套猜测（有空格、没有扩展名都认），
   * 还能认出文件夹和项目外的路径。不提供时链接按行内代码的规则只认项目里的文件
   */
  resolveLink?(text: string): Promise<LinkTarget | null>
  /** 项目里的文件夹：在文件树里展开定位 */
  showFolder?(path: string): void
  /** 项目外的本机路径：在系统文件夹中显示 */
  revealOutside?(path: string): void
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
  // /E:/x/a.ts：Codex 按它的习惯给绝对路径前面加 /，Windows 上盘符前面多出来的这个 / 去掉
  path = path.replace(/^\/(?=[A-Za-z]:[\\/])/, '')
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

/** 路径的点击处理和悬停提示：单击打开、双击在文件夹中显示；没有上下文时为 null */
export function usePathClick(
  target: PathTarget | null,
): { handlers: ReturnType<typeof pathClickHandlers>; title: string } | null {
  const links = useContext(PathLinksContext)
  if (!links || !target) return null
  const { reveal } = links
  return {
    handlers: pathClickHandlers({ open: () => links.open(target), reveal: reveal && (() => reveal(target)) }),
    title: links.hint(targetTitle(target)),
  }
}

/** 路径元素上的标记：右键菜单（features/session/contextMenu）从这里取出路径和行列 */
export const pathData = (t: PathTarget): Record<string, string | undefined> => ({
  'data-path': t.path,
  'data-path-line': t.line ? String(t.line) : undefined,
  'data-path-column': t.column ? String(t.column) : undefined,
})

const targetTitle = (t: PathTarget): string => t.path + (t.line ? `:${t.line}` : '') + (t.column ? `:${t.column}` : '')

/** Markdown 的行内代码：是项目里的文件时变成可点击的路径 */
export function InlineCode({ children, className }: { children?: ReactNode; className?: string }) {
  const text = typeof children === 'string' ? children : null
  const target = usePathTarget(text)
  const click = usePathClick(target)
  if (!click || !target) return <code className={className}>{children}</code>
  return (
    <code
      {...pathData(target)}
      role="link"
      tabIndex={0}
      title={click.title}
      className={cn(className, 'cursor-pointer')}
      {...click.handlers}
    >
      {children}
    </code>
  )
}

/** 链接地址对应的本地路径（文件、文件夹、项目外的路径）；还在查、不是本地路径或没有上下文时为 null */
export function useLinkTarget(text: string | null): LinkTarget | null {
  const links = useContext(PathLinksContext)
  const [found, setFound] = useState<{ text: string; target: LinkTarget | null } | null>(null)
  useEffect(() => {
    if (!links || !text || text.length > 1024) return
    let live = true
    const resolve: Promise<LinkTarget | null> = links.resolveLink
      ? links.resolveLink(text)
      : maybePath(text)
        ? links.resolve(text).then(t => (t ? { kind: 'file' as const, ...t } : null))
        : Promise.resolve(null)
    resolve.then(target => live && setFound({ text, target })).catch(() => undefined)
    return () => {
      live = false
    }
  }, [links, text])
  return found && found.text === text ? found.target : null
}

/** 链接的点击处理、悬停提示和给右键菜单的标记：文件单击打开；文件夹单击在文件树中显示；项目外的路径只能在文件夹中显示 */
function linkClick(
  links: PathLinks,
  target: LinkTarget,
): { handlers: ReturnType<typeof pathClickHandlers>; title: string; data: Record<string, string | undefined> } | null {
  const { reveal } = links
  if (target.kind === 'file')
    return {
      handlers: pathClickHandlers({ open: () => links.open(target), reveal: reveal && (() => reveal(target)) }),
      title: links.hint(targetTitle(target)),
      data: pathData(target),
    }
  if (target.kind === 'folder') {
    const { showFolder } = links
    if (!showFolder) return null
    const folder = { path: target.path, line: null, column: null }
    return {
      handlers: pathClickHandlers({ open: () => showFolder(target.path), reveal: reveal && (() => reveal(folder)) }),
      title: links.hint(target.path + '/', 'folder'),
      data: { 'data-path': target.path, 'data-path-kind': 'folder' },
    }
  }
  const { revealOutside } = links
  if (!revealOutside) return null
  return {
    handlers: pathClickHandlers({ open: () => revealOutside(target.path), reveal: null }),
    title: links.hint(target.path, 'outside'),
    data: { 'data-path-outside': target.path, 'data-path-kind': target.folder ? 'folder' : 'file' },
  }
}

/**
 * Markdown 链接：地址是项目里的文件时在软件里打开，是项目里的文件夹时在文件树里显示，
 * 是项目外本机上存在的路径时在文件夹中显示（不打开）；网址交给系统浏览器（主进程只放行 http / https）
 */
export function MarkdownLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const links = useContext(PathLinksContext)
  const target = useLinkTarget(linkPathText(href))
  const click = links && target ? linkClick(links, target) : null
  if (click)
    return (
      <a
        {...rest}
        href={href}
        {...click.data}
        title={click.title}
        {...click.handlers}
        onClick={e => {
          e.preventDefault()
          click.handlers.onClick(e)
        }}
      >
        {children}
      </a>
    )
  // 本地路径但找不到（或还在查、远程机器上项目外的路径）：只显示文字，不当网址打开
  if (href && isLocalHref(href)) return <span title={readable(href)}>{children}</span>
  return (
    <a {...rest} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}
