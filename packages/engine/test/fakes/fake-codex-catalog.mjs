// fake-codex.mjs 在主体之前加载：模型目录（src/codex/model-catalog.ts）用到的两种调用。命中时不往下执行主体
// （debug 直接退出；实测模式停在顶层 await 上，等一轮开始时退出），也不记进 FAKE_CODEX_ARGV
import readline from 'node:readline'

export const FAKE_DEFAULT_PROMPT = 'You are the fake Codex default prompt.'

// codex debug models --bundled：自带目录只有 gpt-5 系列和 o3，上限都是 272K
if (process.argv[2] === 'debug' && process.argv[3] === 'models') {
  const entry = slug => ({ slug, display_name: slug, context_window: 272000, max_context_window: 272000 })
  process.stdout.write(JSON.stringify({ models: ['gpt-5', 'gpt-5-mini', 'o3'].map(entry) }))
  process.exit(0)
}

// 实测默认提示词（model_provider="probe"）：一轮开始时把第一条 developer 消息发给假服务
if (process.argv.includes('model_provider="probe"')) {
  const spec = process.argv.find(a => a.startsWith('model_providers.probe='))
  const base = /base_url = "([^"]+)"/.exec(spec ?? '')?.[1]
  const reply = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + '\n')
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const msg = JSON.parse(line)
    if (msg.method === 'initialize') reply(msg.id, {})
    else if (msg.method === 'thread/start') reply(msg.id, { thread: { id: 'probe-thread' } })
    else if (msg.method === 'turn/start')
      void fetch(`${base}/responses`, {
        method: 'POST',
        body: JSON.stringify({
          input: [{ type: 'message', role: 'developer', content: [{ type: 'input_text', text: FAKE_DEFAULT_PROMPT }] }],
        }),
      }).finally(() => process.exit(0))
  })
  await new Promise(() => {})
}
