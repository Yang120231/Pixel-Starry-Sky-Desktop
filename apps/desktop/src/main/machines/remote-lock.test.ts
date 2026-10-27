import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { stopStale } from './remote-lock'

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('远端辅助进程的旧实例', () => {
  it('结束还活着的旧进程；已经不在的直接算结束', () => {
    // 经一个中间进程启动、中间进程马上退出：目标不是测试进程的子进程（和真实的旧辅助进程一样由别人回收），
    // 否则在 macOS / Linux 上它结束后会因为没人回收一直算「活着」
    const pid = Number(
      execFileSync(process.execPath, [
        '-e',
        "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});c.unref();process.stdout.write(String(c.pid))",
      ]).toString(),
    )
    expect(alive(pid)).toBe(true)
    expect(stopStale(pid, 2000)).toBe(true)
    expect(alive(pid)).toBe(false)
    expect(stopStale(pid, 100)).toBe(true)
  })
})
