import { Globe } from 'lucide-react'
import { IconButton } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import type { CodingWorkspace } from '../workspace'
import type { PortEntry } from './portsModel'

/** 和 panel/EnvironmentPanel.tsx 的 OPEN_BROWSER 同值（不引那个大组件文件） */
const OPEN_BROWSER = 'pixelsky:open-browser'

export function PortsTab({ workspace, ports }: { workspace: CodingWorkspace; ports: PortEntry[] }) {
  useI18n()
  return (
    <div
      role="tabpanel"
      id="coding-bottom-page-ports"
      aria-labelledby="coding-bottom-tab-ports"
      className="min-w-0 flex-1 overflow-auto"
    >
      {ports.length === 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-meta text-fg-faint">
          {tr('coding.bottom.ports.empty')}
        </div>
      ) : (
        <ul className="flex flex-col py-1">
          {ports.map(entry => (
            <li
              key={entry.port}
              data-coding-port={entry.port}
              className="group flex h-8 items-center gap-3 px-4 text-ui hover:bg-hover"
            >
              <span className="w-24 shrink-0 font-mono tabular-nums">
                {tr('coding.bottom.ports.port', { port: entry.port })}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-meta text-fg-muted">{entry.url}</span>
              <span className="min-w-0 max-w-[40%] truncate text-meta text-fg-faint">
                {entry.sources.map(s => s.label).join(', ')}
              </span>
              <IconButton
                icon={Globe}
                label={tr('coding.bottom.ports.open')}
                disabled={!workspace.ref}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent(OPEN_BROWSER, { detail: { ref: workspace.ref, url: entry.url } }),
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
