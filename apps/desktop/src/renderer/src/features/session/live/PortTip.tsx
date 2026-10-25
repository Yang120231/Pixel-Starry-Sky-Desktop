// 命令输出里出现本机地址时，对话末尾的「在内置浏览器打开」提示条（不挂在命令行下：默认模式下命令行都收在折叠的「执行」块里）（docs/ui/port-preview.md）
import { useContext, useState } from 'react'
import { ChevronDown, ChevronRight, Globe } from 'lucide-react'
import { Button, CopyButton, cn } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { getActiveWorkspace } from '@/features/editor/target'
import { portUrl } from '@/features/coding/bottom/portsModel'
import { ImageSessionContext } from '../attachments/imageSource'
import { ignorePorts, markOpened, usePortState } from './portTips'
import type { FoundPort } from './portTipsModel'

/** 和 panel/EnvironmentPanel.tsx 的 OPEN_BROWSER 同值（不引那个大组件文件） */
const OPEN_BROWSER = 'pixelsky:open-browser'
const BOX = 'my-1 rounded-lg border border-line-card bg-surface text-meta text-fg-secondary'
const ROW = 'flex min-h-[34px] flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1'
const SMALL = 'h-6 px-2 text-meta'

function openPort(sessionId: string, port: number): void {
  // 浏览器标签跟着右侧面板当前的工作区走，请求要用同一个 ref 才会被接住（files/htmlPreview.ts）
  const ref = getActiveWorkspace().ref ?? { sessionId }
  window.dispatchEvent(new CustomEvent(OPEN_BROWSER, { detail: { ref, url: portUrl(port) } }))
  markOpened(sessionId, port)
}

const Dot = ({ opened }: { opened?: boolean }) => (
  <span className={cn('size-1.5 shrink-0 rounded-full', opened ? 'bg-accent' : 'bg-success')} />
)
const PortName = ({ port }: { port: number }) => <span className="font-mono text-ui text-fg">:{port}</span>

function PortActions({
  sessionId,
  found,
  opened,
  primary,
}: {
  sessionId: string
  found: FoundPort
  opened: boolean
  primary?: boolean
}) {
  return (
    <>
      <Button
        variant={opened ? 'ghost' : primary ? 'primary' : 'outline'}
        icon={opened ? undefined : Globe}
        className={SMALL}
        onClick={() => openPort(sessionId, found.port)}
      >
        {opened ? tr('portTip.show') : tr('portTip.open')}
      </Button>
      <CopyButton text={portUrl(found.port)} label={tr('portTip.copy')} />
      {!opened && (
        <Button variant="ghost" className={SMALL} onClick={() => ignorePorts(sessionId, [found.port])}>
          {tr('portTip.ignore')}
        </Button>
      )}
    </>
  )
}

/** 画在对话末尾：没有（没被忽略的）端口就什么也不画 */
export function PortTip() {
  useI18n()
  const sessionId = useContext(ImageSessionContext)
  const state = usePortState(sessionId)
  const [expanded, setExpanded] = useState(false)
  const ports = state.found.filter(f => !state.ignored.has(f.port))
  if (!sessionId || !ports.length) return null

  if (ports.length === 1) {
    const only = ports[0]
    const opened = state.opened.has(only.port)
    return (
      <div data-port-tip className={cn(BOX, ROW, opened && 'border-dashed bg-transparent text-fg-faint')}>
        <Dot opened={opened} />
        <span>{tr('portTip.one')}</span>
        <PortName port={only.port} />
        {opened && <span className="text-fg-faint">· {tr('portTip.opened')}</span>}
        <span className="min-w-0 flex-1" />
        <PortActions sessionId={sessionId} found={only} opened={opened} primary />
      </div>
    )
  }

  const latest = ports[ports.length - 1]
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <div data-port-tip className={BOX}>
      <div className={ROW}>
        <Dot />
        <span>{tr('portTip.many', { n: ports.length })}</span>
        {!expanded &&
          ports.map(p => (
            <span key={p.port} className="rounded-sm bg-subtle px-1.5 font-mono text-fg-secondary">
              :{p.port}
            </span>
          ))}
        <span className="min-w-0 flex-1" />
        {!expanded && (
          <Button variant="primary" icon={Globe} className={SMALL} onClick={() => openPort(sessionId, latest.port)}>
            {tr('portTip.openPort', { port: latest.port })}
          </Button>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={tr(expanded ? 'portTip.collapse' : 'portTip.expand')}
          onClick={() => setExpanded(!expanded)}
          className="press inline-flex size-6 items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg"
        >
          <Chevron size={13} strokeWidth={1.75} />
        </button>
        <Button
          variant="ghost"
          className={SMALL}
          onClick={() =>
            ignorePorts(
              sessionId,
              ports.map(p => p.port),
            )
          }
        >
          {tr(expanded ? 'portTip.ignoreAll' : 'portTip.ignore')}
        </Button>
      </div>
      {expanded &&
        ports.map(p => (
          <div key={p.port} className={cn(ROW, 'border-t border-line-subtle')}>
            <Dot opened={state.opened.has(p.port)} />
            <PortName port={p.port} />
            <span className="min-w-0 truncate font-mono text-fg-faint" title={p.command}>
              {p.command}
            </span>
            <span className="min-w-0 flex-1" />
            <PortActions sessionId={sessionId} found={p} opened={state.opened.has(p.port)} />
          </div>
        ))}
    </div>
  )
}
