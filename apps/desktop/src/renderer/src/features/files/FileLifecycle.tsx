import { tr } from '../../i18n/core'
import { useEffect, useReducer } from 'react'
import { bridge, useEngineState } from '@/features/engine'
import { usePaneState } from '@/features/panes/store'
import { isFileTab, leaves } from '@/features/panes/tree'
import { activateFile, checkOpenFiles, ensureFile, getFiles, hasDirtyFiles, refreshActiveHead } from './store'
import { confirmFiles } from './FileConfirm'

export function FileLifecycle() {
  const layout = usePaneState(s => s.layout)
  // AI 改了文件时核对打开的文件。原来每次通知都把所有快照的全部条目扫一遍拼成字符串，任何会话每输出一个字就扫一次
  // （docs/perf-audit-2026-10-18.md B3）：现在只看文件改动、回退、整份换掉的事件，以及打开 / 释放了哪些快照
  const opened = useEngineState(s => Object.keys(s.snapshots).join('|'))
  const [changeKey, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(
    () =>
      bridge?.onEvent(e => {
        if (e.kind !== 'session') return
        const ev = e.event
        if (
          ((ev.type === 'item_started' || ev.type === 'item_completed') && ev.item.kind === 'file_change') ||
          ev.type === 'items_truncated' ||
          ev.type === 'items_reset'
        )
          bump()
      }),
    [],
  )
  useEffect(() => {
    for (const tab of leaves(layout.root)
      .flatMap(l => l.tabs)
      .filter(isFileTab))
      void ensureFile(tab)
    const tab = leaves(layout.root).find(l => l.id === layout.focused)?.active
    if (tab && isFileTab(tab)) activateFile(tab)
  }, [layout])
  useEffect(() => {
    checkOpenFiles()
  }, [changeKey, opened])
  useEffect(() => {
    window.addEventListener('focus', checkOpenFiles)
    // 在终端里提交过：正在看的标签的「变更」基准跟上新的 HEAD
    window.addEventListener('focus', refreshActiveHead)
    const before = (e: BeforeUnloadEvent): void => {
      if (hasDirtyFiles()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', before)
    const unsubscribe = window.pixelsky?.files.onBeforeClose(() => {
      void confirmFiles(
        getFiles().tabs.map(t => t.id),
        tr('files.FileConfirm.quitApplication'),
      ).then(ok => {
        if (ok) void window.pixelsky!.files.finishClose()
      })
    })
    return () => {
      window.removeEventListener('focus', checkOpenFiles)
      window.removeEventListener('focus', refreshActiveHead)
      window.removeEventListener('beforeunload', before)
      unsubscribe?.()
    }
  }, [])
  return null
}
