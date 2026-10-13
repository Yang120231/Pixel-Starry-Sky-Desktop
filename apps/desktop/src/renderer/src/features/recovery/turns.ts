// 轻量模式下对话显示的轮数（docs/ui/renderer-memory.md §3.1.4）

/** 轻量模式下对话最多显示的轮数 */
export const LIGHTWEIGHT_TURNS = 20

/** 设置里的轮数遇到轻量模式：最多 LIGHTWEIGHT_TURNS 轮（null 是全部） */
export const capTurns = (wanted: number | null, lightweight: boolean): number | null =>
  lightweight ? Math.min(wanted ?? LIGHTWEIGHT_TURNS, LIGHTWEIGHT_TURNS) : wanted
