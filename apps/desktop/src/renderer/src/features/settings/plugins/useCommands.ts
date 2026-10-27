import { useEffect, useMemo, useState } from 'react'
import { ENGINES, type EngineId, type SkillCommand } from '@pixelsky/protocol'
import { useEngineState } from '@/features/engine'
import { useActiveWorkspace } from '@/features/editor/target'
export function useCommands(sessionId: string | null | undefined, engine: EngineId | undefined): SkillCommand[] {
  const workspace = useActiveWorkspace(),
    snapshot = useEngineState(state => (sessionId ? state.snapshots[sessionId] : undefined)),
    [configured, setConfigured] = useState<SkillCommand[]>([])
  useEffect(() => {
    let active = true
    const load = (): void => {
      // 应用管理的插件命令只给能力表 pluginCommands 为真的引擎
      if (engine && !ENGINES[engine]?.caps.pluginCommands) {
        setConfigured([])
        return
      }
      void window.pixelsky?.extensions
        .commands(sessionId ? { sessionId } : workspace.ref)
        .then(commands => {
          if (active) setConfigured(commands)
        })
        .catch(() => {
          if (active) setConfigured([])
        })
    }
    load()
    const stop = window.pixelsky?.extensions.onChange(load)
    return () => {
      active = false
      stop?.()
    }
    // 有会话时按会话取，不跟着当前工作区变：切标签页会换工作区，每个挂着的会话都重扫一遍插件（主进程同步扫描，用户机器上每次约 3.5 秒）
  }, [sessionId, sessionId ? null : workspace.key, engine])
  const loaded = snapshot?.commands
  return useMemo(
    () =>
      (loaded ?? configured).filter(
        command => !/^(?:mcp|plugin|plugins|login|logout|config|background|reload-plugins)$/.test(command.name),
      ),
    [loaded, configured],
  )
}
