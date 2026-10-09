import { useI18n } from '@/i18n/I18nProvider'
import { cn } from '@/components/ui'

/**
 * 一根「文字」横条。cn 只拼接字符串、不会合并冲突的类名，
 * 所以颜色（tone）和高度（h）用独立参数替换默认值，而不是追加。
 */
function Bar({ w, tone = 'bg-line-strong', h = 'h-[3px]' }: { w: string; tone?: string; h?: string }) {
  useI18n()
  return <div className={cn('shrink-0 rounded-full', h, tone)} style={{ width: w }} />
}

const NAV_WIDTHS = ['70%', '55%', '80%', '62%', '74%', '48%', '66%', '58%', '72%', '52%']
const RECENT_WIDTHS = ['82%', '68%', '76%', '60%', '84%', '64%', '70%', '56%']

function MiniCard({ rows }: { rows: string[] }) {
  useI18n()
  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded-md border border-line bg-surface p-2">
      <div className="flex items-center gap-1.5">
        <div className="size-2.5 rounded-sm bg-line-strong" />
        <Bar w="28%" tone="bg-fg-faint" />
        <div className="flex-1" />
        <Bar w="10%" tone="bg-line" />
      </div>
      {rows.map((w, i) => (
        <div key={i} className="flex items-center justify-between">
          <Bar w={w} />
          <Bar w="8%" tone="bg-line" />
        </div>
      ))}
    </div>
  )
}

/** 批注编号圆点（中心对准 className 给出的 left/top） */
function AnnotationMarker({ className }: { className?: string }) {
  useI18n()
  return (
    <div
      className={cn(
        'absolute z-10 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-meta font-semibold text-accent-on shadow-sm ring-2 ring-wall-tint',
        className,
      )}
    >
      1
    </div>
  )
}

/** 假的网页画面：用色块拼出的工作台缩略图，叠一个批注编号 */
export function PreviewViewport() {
  useI18n()
  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-app">
      {/* 迷你图标栏 */}
      <div className="flex w-[4%] shrink-0 flex-col items-center gap-2 border-r border-line-subtle bg-rail py-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="size-2 rounded-sm bg-line-strong" />
        ))}
      </div>

      {/* 迷你侧栏 */}
      <div className="flex w-[26%] shrink-0 flex-col gap-2 overflow-hidden border-r border-line-subtle bg-sidebar px-2 py-2.5">
        {/* 横条用 bg-line-strong（正文）/ bg-fg-faint（标题），浅色、深色下都能和 bg-sidebar 区分开 */}
        <Bar w="45%" h="h-1" tone="bg-fg-faint" />
        <Bar w="38%" />
        <div className="mt-1 flex flex-col gap-2">
          <Bar w="22%" tone="bg-fg-faint" />
          <Bar w="76%" />
          <Bar w="84%" />
        </div>
        <div className="mt-1 flex flex-col gap-2">
          <Bar w="24%" tone="bg-fg-faint" />
          {NAV_WIDTHS.map((w, i) =>
            i === 1 ? (
              <div key={i} className="rounded-sm bg-surface px-1 py-1 shadow-sm">
                <Bar w={w} tone="bg-fg-faint" />
              </div>
            ) : i === 4 ? (
              /* 批注 1 钉在侧栏右边缘、中部的这一行（与参考图位置一致） */
              <div key={i} className="relative">
                <Bar w={w} />
                <AnnotationMarker className="left-[92%] top-1/2" />
              </div>
            ) : (
              <Bar key={i} w={w} />
            ),
          )}
        </div>
        <div className="mt-1 flex flex-col gap-2">
          <Bar w="20%" tone="bg-fg-faint" />
          {RECENT_WIDTHS.map((w, i) => (
            <Bar key={i} w={w} />
          ))}
        </div>
      </div>

      {/* 迷你主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-5 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
          <Bar w="34%" h="h-1" tone="bg-fg-faint" />
          <div className="flex-1" />
          <div className="h-2.5 w-5 rounded-sm border border-line" />
          <div className="h-2.5 w-5 rounded-sm border border-line" />
          <Bar w="8%" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-[8%] pt-3">
          <Bar w="18%" tone="bg-fg-faint" />
          <Bar w="88%" />
          <Bar w="30%" tone="bg-fg-faint" />
          <div className="flex flex-col gap-1.5 pl-2">
            <Bar w="72%" />
            <Bar w="80%" />
            <Bar w="64%" />
          </div>
          <MiniCard rows={['40%', '46%', '36%']} />
          <div className="ml-auto w-[62%] shrink-0 rounded-md bg-subtle px-2 py-1.5">
            <Bar w="90%" tone="bg-fg-faint" />
          </div>
          <Bar w="18%" tone="bg-fg-faint" />
          <Bar w="92%" />
          <Bar w="86%" />
          <Bar w="40%" />
          <MiniCard rows={['44%', '34%']} />
          <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface p-2">
            <div className="size-3 rounded-sm bg-accent/40" />
            <Bar w="30%" />
            <div className="flex-1" />
            <Bar w="8%" tone="bg-line" />
          </div>
          <div className="flex shrink-0 gap-1.5">
            {['22%', '26%', '24%'].map((w, i) => (
              <div key={i} className="h-3 rounded-sm border border-line" style={{ width: w }} />
            ))}
          </div>
        </div>

        {/* 迷你输入框 */}
        <div className="mx-[8%] mt-2 mb-3 flex h-12 shrink-0 flex-col justify-between rounded-lg border border-line bg-surface p-2">
          <Bar w="40%" />
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-line-strong" />
            <Bar w="14%" tone="bg-line" />
            <div className="flex-1" />
            <Bar w="16%" tone="bg-line" />
            <div className="size-2.5 rounded-full bg-disabled" />
          </div>
        </div>
      </div>

    </div>
  )
}
