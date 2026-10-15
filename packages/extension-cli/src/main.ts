import { isMainThread, workerData } from 'node:worker_threads'
import { main } from './cli/main'
import { nodeIo } from './cli/io'
import { GRAMMAR_WORKER_KIND, grammarWorkerMain } from './lib/grammar/worker'

if (!isMainThread && (workerData as { kind?: string } | null)?.kind === GRAMMAR_WORKER_KIND) {
  await grammarWorkerMain()
} else {
  process.exitCode = await main(process.argv.slice(2), nodeIo())
}
