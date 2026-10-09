import { useI18n } from '@/i18n/I18nProvider'
import { assistantReply } from '@/data'

/** 助手回复：正文 14px / 行高 1.7；行内代码用浅底等宽小块 */
export function AssistantMessage() {
  useI18n()
  if (!assistantReply) return null
  return (
    <div className="text-prose text-fg-body [&_code]:rounded-sm [&_code]:bg-subtle [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]">
      <p>{assistantReply.intro}</p>
      <ul className="my-2.5 list-disc space-y-1 pl-6 marker:text-fg-faint">
        {assistantReply.bullets.map((b, i) => (
          <li key={i} className="pl-1">
            {b.text}
            {b.bold && <strong className="font-semibold text-fg">{b.bold}</strong>}
            {b.after}
          </li>
        ))}
      </ul>
      <p>{assistantReply.outro}</p>
    </div>
  )
}
