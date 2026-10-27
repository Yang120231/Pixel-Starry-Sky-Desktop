// 远端辅助进程的单实例锁用（remote-entry.ts）。随辅助进程一起打包上传，不导入 electron

/** 结束旧的辅助进程：先 SIGTERM，最多等 graceMs，还在就 SIGKILL 再等 1 秒；结束了返回 true */
export function stopStale(pid: number, graceMs = 5000): boolean {
  const alive = (): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  const gone = (ms: number): boolean => {
    for (let waited = 0; waited < ms; waited += 100) {
      if (!alive()) return true
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
    return !alive()
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return !alive()
  }
  if (gone(graceMs)) return true
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* 刚好自己退了 */
  }
  return gone(1000)
}
