import type { WorkspaceChoice } from '../../../preload/machines'
const KEY = 'pixelsky.new-workspace-targets'
let targets: Record<string, WorkspaceChoice> = {}
try {
  targets = JSON.parse(localStorage.getItem(KEY) ?? '{}')
} catch {}
export const draftWorkspace = (tab: string): WorkspaceChoice | null => targets[tab] ?? null
export function bindDraftWorkspace(tab: string, workspace: WorkspaceChoice): void {
  if (targets[tab]) return
  targets = { ...targets, [tab]: workspace }
  try {
    localStorage.setItem(KEY, JSON.stringify(targets))
  } catch {}
}
