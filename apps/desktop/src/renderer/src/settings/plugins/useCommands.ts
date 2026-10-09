import { useEffect, useMemo, useState } from 'react'
import type { SkillCommand } from '@pixelsky/protocol'
import { useEngineState } from '@/engine'
import { useActiveWorkspace } from '@/editor/target'
export function useCommands(sessionId:string|null|undefined,engine:string|undefined):SkillCommand[] {
  const workspace=useActiveWorkspace(),snapshot=useEngineState(state=>sessionId?state.snapshots[sessionId]:undefined),[configured,setConfigured]=useState<SkillCommand[]>([])
  useEffect(()=>{
    let active=true
    const load=():void=>{if(engine&&engine!=='claude'){setConfigured([]);return}void window.pixelsky?.extensions.commands(sessionId?{sessionId}:workspace.ref).then(commands=>{if(active)setConfigured(commands)}).catch(()=>{if(active)setConfigured([])})}
    load();const stop=window.pixelsky?.extensions.onChange(load);return ()=>{active=false;stop?.()}
  },[sessionId,workspace.key,engine])
  const loaded=snapshot?.commands
  return useMemo(()=>(loaded??configured).filter(command=>!/^(?:mcp|plugin|plugins|login|logout|config|background|reload-plugins)$/.test(command.name)),[loaded,configured])
}
