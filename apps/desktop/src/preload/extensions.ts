import type {
  ExtensionCheck,
  ExtensionEntry,
  ExtensionImport,
  ExtensionInput,
  ExtensionScope,
  ExtensionState,
  SkillCommand,
} from '@pixelsky/protocol'
import type { WorkspaceRef } from './workspace'
export interface ExtensionsBridge {
  state(ref?: WorkspaceRef | null): Promise<ExtensionState>
  save(data: ExtensionInput): Promise<ExtensionEntry>
  import(data: ExtensionImport): Promise<ExtensionEntry>
  importMcp(json: string, scope: ExtensionScope): Promise<number>
  toggle(id: string, enabled: boolean): Promise<void>
  remove(id: string): Promise<void>
  check(id: string, ref?: WorkspaceRef | null): Promise<ExtensionCheck>
  update(id: string, apply: boolean): Promise<{ changed: boolean; message: string }>
  skillText(id: string, ref?: WorkspaceRef | null): Promise<{ text: string; version: string; readOnly: boolean }>
  choose(kind: 'directory' | 'program'): Promise<string | null>
  reveal(id: string, ref?: WorkspaceRef | null): Promise<void>
  commands(ref?: WorkspaceRef | null): Promise<SkillCommand[]>
  onChange(callback: () => void): () => void
}
