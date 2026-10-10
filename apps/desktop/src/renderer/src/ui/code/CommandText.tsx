import { memo } from 'react'
import { highlight, shellLanguage } from './highlight'

/** 按 shell 语法着色的命令（docs/ui/content-highlight.md §2 B）；外层的 code / pre 由调用方给 */
export const CommandText = memo(function CommandText({ command }: { command: string }) {
  return <>{highlight(command, shellLanguage(command))}</>
})
