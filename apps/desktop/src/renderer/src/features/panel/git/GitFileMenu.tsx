import {
  Copy,
  ExternalLink,
  FileClock,
  FileCode2,
  FileDiff,
  FolderOpen,
  FolderSearch,
  Minus,
  Plus,
  Undo2,
} from 'lucide-react'
import { ActionMenu, type MenuAction } from '@/ui/ActionMenu'
import { useToast } from '@/ui'
import { tr, translateMessage } from '@/i18n/core'
import { openFile, showFiles } from '@/features/files/store'
import { isRemoteRef, revealPath } from '@/features/files/reveal'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'
import { gitAbsolutePath, splitPath } from './gitModel'

export interface GitFileMenuPosition {
  x: number
  y: number
  trigger: HTMLElement
}

/** 工作区更改与提交历史共用路径、定位操作；写操作沿用各自宿主的忙碌状态和确认框。 */
export function GitFileMenu({
  file,
  target,
  root,
  demo,
  position,
  busy = false,
  onClose,
  onDiff,
  onOpen,
  onHistory,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: { path: string; origPath?: string | null; local?: string | null }
  target: WorkspaceRef
  root: string
  demo: boolean
  position: GitFileMenuPosition
  busy?: boolean
  onClose(): void
  onDiff(): void
  onOpen?: () => void
  onHistory?: () => void
  onStage?: () => void
  onUnstage?: () => void
  onDiscard?: () => void
}) {
  const toast = useToast()
  const report = (e: unknown) => toast(translateMessage((e as Error).message))
  const copy = (value: string) => void navigator.clipboard.writeText(value).catch(report)
  const available = !!onOpen && !!file.local
  const actions: MenuAction[] = [
    { label: tr('git.open'), icon: FileCode2, disabled: !onOpen, run: onOpen },
    { label: tr('git.viewDiff'), icon: FileDiff, run: onDiff },
    {
      label: tr('git.file.revealTree'),
      icon: FolderSearch,
      disabled: !available,
      run: () =>
        void openFile(target, file.local!)
          .then(() => showFiles(target, file.local!))
          .catch(report),
    },
    {
      label: tr('git.file.revealExplorer'),
      icon: FolderOpen,
      disabled: !available || demo || isRemoteRef(target),
      run: () => void revealPath(target, file.local!, toast),
    },
    {
      label: tr('panes.PaneView.openWithExternalEditor'),
      icon: ExternalLink,
      disabled: !available || demo,
      run: () => void window.pixelsky!.editor.open(target, undefined, file.local!).catch(report),
    },
    { label: tr('git.history.file.show'), icon: FileClock, disabled: !onHistory, run: onHistory },
    { label: tr('git.file.copyName'), icon: Copy, separator: true, run: () => copy(splitPath(file.path).name) },
    { label: tr('coding.editor.copyRelPath'), icon: Copy, run: () => copy(file.local ?? file.path) },
    {
      label: tr('coding.editor.copyPath'),
      icon: Copy,
      disabled: !root,
      run: () => copy(gitAbsolutePath(root, file.path)),
    },
    ...(file.origPath ? [{ label: tr('git.file.copyOldPath'), icon: Copy, run: () => copy(file.origPath!) }] : []),
    ...(onStage ? [{ label: tr('git.stage'), icon: Plus, separator: true, disabled: busy, run: onStage }] : []),
    ...(onUnstage ? [{ label: tr('git.unstage'), icon: Minus, separator: true, disabled: busy, run: onUnstage }] : []),
    ...(onDiscard ? [{ label: tr('git.discard'), icon: Undo2, danger: true, disabled: busy, run: onDiscard }] : []),
  ]
  return <ActionMenu {...position} label={file.path} actions={actions} onClose={onClose} />
}
