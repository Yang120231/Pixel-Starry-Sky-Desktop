import { parentPort } from 'node:worker_threads'
import { createTmEngine } from './engine'
import { runGrammarJob } from './run'
import type { GrammarJob } from './run'

export const GRAMMAR_WORKER_KIND = 'pixelsky-ext/grammar'

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 读 workerData，循环处理 parentPort 的消息：先回 ready（或 fatal），之后每个 job 回 done / failed */
export async function grammarWorkerMain(): Promise<void> {
  const port = parentPort
  if (!port) return
  let engine
  try {
    engine = await createTmEngine()
  } catch (e) {
    port.postMessage({ type: 'fatal', error: errText(e) })
    return
  }
  port.on('message', (m: { type: string; job?: GrammarJob }) => {
    if (m.type !== 'job' || !m.job) return
    runGrammarJob(m.job, engine, () => performance.now()).then(
      value => port.postMessage({ type: 'done', value }),
      e => port.postMessage({ type: 'failed', error: errText(e) }),
    )
  })
  port.postMessage({ type: 'ready' })
}
