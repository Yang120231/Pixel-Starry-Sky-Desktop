// 回复正文：和桌面端用同一套库（react-markdown + remark-gfm），先不带代码高亮和公式（packages/ui 抽出后换成共用的）。
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown text-prose text-fg-body">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  )
}
