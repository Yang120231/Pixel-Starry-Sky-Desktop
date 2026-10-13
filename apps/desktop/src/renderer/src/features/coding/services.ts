import { useEffect, useState } from 'react'
import type { ServiceDefinition } from '../../../../shared/types/project-tools'
import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { isDemo } from '@/data'
import { demo } from '@/data/demo'

export interface ServicesState {
  services: ServiceDefinition[]
  loading: boolean
  error: string | null
}
const NONE: ServiceDefinition[] = []

/**
 * 项目的服务列表（底栏端口页、状态栏用）。真实模式读 projectTools.services，服务状态变了（onChange）重新读，
 * 做法照 EnvironmentPanel；演示模式读 demo().projectTools.environment.services
 */
export function useServices(ref: WorkspaceRef | null): ServicesState {
  const key = ref ? JSON.stringify(ref) : ''
  const [state, setState] = useState<ServicesState>({ services: NONE, loading: !isDemo && !!ref, error: null })
  useEffect(() => {
    if (isDemo) {
      setState({ services: ref ? demo().projectTools.environment.services : NONE, loading: false, error: null })
      return
    }
    if (!ref) {
      setState({ services: NONE, loading: false, error: null })
      return
    }
    let gone = false
    const read = (): void => {
      void window
        .pixelsky!.projectTools.services(ref)
        .then(services => {
          if (!gone) setState({ services, loading: false, error: null })
        })
        .catch((e: Error) => {
          if (!gone) setState(s => ({ ...s, loading: false, error: e.message }))
        })
    }
    setState(s => ({ ...s, loading: true }))
    read()
    const off = window.pixelsky!.projectTools.onChange(read)
    return () => {
      gone = true
      off()
    }
    // ref 只在 key 变化时才会变（key 由 ref 序列化而来）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}
