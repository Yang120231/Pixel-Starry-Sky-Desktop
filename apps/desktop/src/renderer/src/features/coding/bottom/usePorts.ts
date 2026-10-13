import { useEffect, useMemo, useState } from 'react'
import { subscribeTerminalHistory, terminalHistoryText, useTerminalStore } from '@/features/terminal/store'
import { workspaceTerminals } from '@/features/terminal/workspace'
import type { CodingWorkspace } from '../workspace'
import { useServices } from '../services'
import { mergePorts, type PortEntry } from './portsModel'

/** 当前项目所有终端的历史输出里出现过的本机端口，加上服务设置的端口 */
export function usePorts(workspace: CodingWorkspace): PortEntry[] {
  const store = useTerminalStore()
  const { services } = useServices(workspace.ref)
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeTerminalHistory(() => setTick(n => n + 1)), [])
  const terminals = useMemo(
    () =>
      workspaceTerminals(store.terminals, workspace.projectId, workspace.path, window.pixelsky?.platform === 'win32'),
    [store.terminals, workspace.projectId, workspace.path],
  )
  return useMemo(
    () =>
      mergePorts(
        terminals.map(t => ({ label: t.title, text: terminalHistoryText(t.id) })),
        services.map(s => ({ label: s.name, port: s.port })),
      ),
    // tick 变了说明历史有新输出
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terminals, services, tick],
  )
}
