import type { WorkspaceRef } from '../../../../shared/types/workspace'

export interface Problem {
  path: string
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
  source: string
}
export interface ProblemSummary {
  errors: number
  warnings: number
  items: Problem[]
}
/** 问题检查（tsc / eslint）接入前为 false：状态栏、活动栏、底部标签、面包屑里的问题入口都不显示。接入后改成 true */
export const PROBLEMS_READY: boolean = false
const EMPTY: ProblemSummary = { errors: 0, warnings: 0, items: [] }
/** 桩：还没接 tsc / eslint（coding-mode.md §3.4），一直返回空 */
export function useProblems(_ref: WorkspaceRef | null): ProblemSummary {
  return EMPTY
}
