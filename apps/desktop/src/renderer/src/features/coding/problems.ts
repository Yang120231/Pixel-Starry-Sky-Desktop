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
const EMPTY: ProblemSummary = { errors: 0, warnings: 0, items: [] }
/** 桩：还没接 tsc / eslint（coding-mode.md §3.4），一直返回空 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useProblems(_ref: WorkspaceRef | null): ProblemSummary {
  return EMPTY
}
