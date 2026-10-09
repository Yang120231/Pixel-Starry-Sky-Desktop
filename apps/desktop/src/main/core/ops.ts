// 以通道名为键的操作表：本机 IPC 和远端辅助进程注册同一张表（docs/restructure.md §8.3 P6）
import type { IPC_CONTRACT, IpcChannelName } from '@pixelsky/protocol'

/** 契约里 `invoke` 类的通道名（和 ipc/guard.ts 的 InvokeChannel 相同；core 不导入 electron 那一侧） */
export type InvokeName = {
  [C in IpcChannelName]: (typeof IPC_CONTRACT)[C]['kind'] extends 'invoke' ? C : never
}[IpcChannelName]
/** 一个操作：上下文 + 调用方传来的原始参数（未校验，一律 unknown） */
export type Op<C> = (c: C, ...args: unknown[]) => unknown
/** 操作表：键是契约里的通道名，远端方法名与通道名相同 */
export type OpTable<C> = Partial<Record<InvokeName, Op<C>>>

/** 本机注册用：逐个取出「通道名, 操作」 */
export function opEntries<C>(table: OpTable<C>): [InvokeName, Op<C>][] {
  return Object.entries(table) as [InvokeName, Op<C>][]
}

/** 远端用：把操作表绑到上下文，得到「方法名 → 函数」，直接并入方法表 */
export function bindOps<C, K extends InvokeName>(
  table: { [P in K]: Op<C> },
  ctx: NoInfer<C>,
): Record<K, (...args: unknown[]) => unknown> {
  const bound = {} as Record<K, (...args: unknown[]) => unknown>
  for (const [channel, op] of opEntries<C>(table)) bound[channel as K] = (...args) => op(ctx, ...args)
  return bound
}
