import { appendFileSync, existsSync } from 'node:fs'
import readline from 'node:readline'
if (process.env.FAKE_CODEX_ARGV)
  appendFileSync(process.env.FAKE_CODEX_ARGV, JSON.stringify(process.argv.slice(2)) + '\n')
// 像真的 codex 一样拒绝不认识的参数（测试用 --fake-bad-arg）：stderr 报错后退出
if (process.argv.includes('--fake-bad-arg')) {
  process.stderr.write(
    "\x1b[1m\x1b[31merror:\x1b[0m unexpected argument '--fake-bad-arg' found\n\nUsage: codex app-server [OPTIONS]\n",
  )
  process.exit(2)
}
const out = value => process.stdout.write(JSON.stringify(value) + '\n')
const emit = (method, params) => out({ method, params })
/** 测试通过创建这个文件打开「恢复线程失败」开关：thread/resume 报错，thread/start 给新线程 id */
const resumeFails = () =>
  !!process.env.FAKE_CODEX_RESUME_FAIL_FILE && existsSync(process.env.FAKE_CODEX_RESUME_FAIL_FILE)
let initialized = false,
  thread = 'fake-thread',
  turn = null,
  next = 0,
  total = 0,
  pending = null
const models = [
  {
    id: 'fake-codex',
    model: 'fake-codex',
    displayName: 'Fake Codex',
    supportedReasoningEfforts: ['low', 'high', 'ultra'].map(reasoningEffort => ({ reasoningEffort })),
    defaultReasoningEffort: 'high',
    inputModalities: ['text', 'image'],
    isDefault: true,
  },
]
function finish(status = 'completed') {
  if (!turn) return
  const current = turn
  turn = null
  clearTimeout(current.timer)
  emit('item/completed', {
    threadId: thread,
    turnId: current.id,
    item: { type: 'agentMessage', id: current.item, text: current.text },
  })
  total += 100
  emit('thread/tokenUsage/updated', {
    threadId: thread,
    turnId: current.id,
    tokenUsage: {
      total: {
        inputTokens: total,
        cachedInputTokens: total / 2,
        cacheWriteInputTokens: 0,
        outputTokens: total / 10,
        totalTokens: total * 1.1,
      },
      last: { inputTokens: 100, cachedInputTokens: 50, outputTokens: 10, totalTokens: 110 },
      modelContextWindow: 128000,
    },
  })
  emit('turn/completed', { threadId: thread, turn: { id: current.id, status, error: null } })
}
function response(message, result) {
  out({ id: message.id, result })
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return
  }
  if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(m) + '\n')
  if (m.result && m.id === 'approve') {
    pending = null
    finish(m.result.decision === 'decline' ? 'interrupted' : 'completed')
    return
  }
  const p = m.params ?? {}
  if (m.method === 'initialize') {
    initialized = true
    response(m, { userAgent: 'fake codex 0.160.1' })
    return
  }
  if (m.method === 'initialized') return
  if (!initialized) {
    out({ id: m.id, error: { code: -32000, message: 'Not initialized' } })
    return
  }
  switch (m.method) {
    case 'account/read':
      response(m, { account: { type: 'apiKey' }, requiresOpenaiAuth: true })
      break
    case 'model/list':
      response(m, { data: models, nextCursor: null })
      break
    case 'config/read':
      response(m, { config: { model: 'fake-codex', model_provider: 'fake', windows: { sandbox: 'elevated' } } })
      break
    case 'configRequirements/read':
      response(m, { requirements: null })
      break
    case 'skills/list':
      response(m, {
        data: [
          {
            cwd: process.cwd(),
            skills: [
              { name: 'probe-skill', description: 'Original skill', path: process.cwd() + '/SKILL.md', enabled: true },
            ],
          },
        ],
      })
      break
    case 'thread/start':
    case 'thread/resume':
      if (m.method === 'thread/resume' && resumeFails()) {
        out({ id: m.id, error: { code: -32000, message: 'thread not found: ' + p.threadId } })
        break
      }
      thread = p.threadId ?? (resumeFails() ? 'fake-thread-new' : 'fake-thread')
      response(m, { thread: { id: thread, turns: [] } })
      break
    case 'turn/start': {
      const id = 'turn-' + ++next,
        text = p.input
          .filter(i => i.type === 'text')
          .map(i => i.text)
          .join('\n')
      if (text.includes('延迟')) {
        // turn/start 的响应晚到：期间不推送任何通知，模拟开轮途中就点了停止
        turn = { id, item: 'msg-' + next, text: '收到：' + text, timer: null, slow: false }
        setTimeout(() => {
          emit('turn/started', { threadId: thread, turn: { id, status: 'inProgress' } })
          response(m, { turn: { id, status: 'inProgress' } })
        }, 400)
        break
      }
      // 缓停：收到 turn/interrupt 后约 1 秒才回 interrupted，且不会自己结束
      turn = { id, item: 'msg-' + next, text: '收到：' + text, timer: null, slow: text.includes('缓停') }
      emit('turn/started', { threadId: thread, turn: { id, status: 'inProgress' } })
      emit('item/started', {
        threadId: thread,
        turnId: id,
        item: { type: 'userMessage', id: 'u-' + next, clientId: p.clientUserMessageId, content: p.input },
      })
      emit('item/started', { threadId: thread, turnId: id, item: { type: 'agentMessage', id: turn.item, text: '' } })
      emit('item/agentMessage/delta', { threadId: thread, turnId: id, itemId: turn.item, delta: turn.text })
      response(m, { turn: { id, status: 'inProgress' } })
      if (text.includes('崩溃')) {
        process.exit(3)
        return
      }
      if (text.includes('重连')) {
        const err = n => ({
          message: `Reconnecting... ${n}/2`,
          additionalDetails:
            'stream disconnected before completion: error sending request for url (https://api.example.test/v1/responses)',
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } },
        })
        emit('error', { threadId: thread, turnId: id, willRetry: true, error: err(1) })
        emit('error', { threadId: thread, turnId: id, willRetry: true, error: err(2) })
        const current = turn
        turn = null
        emit('turn/completed', {
          threadId: thread,
          turn: {
            id: current.id,
            status: 'failed',
            error: {
              message: 'exceeded retry limit, last status: 502 Bad Gateway',
              additionalDetails: 'upstream connect error',
              codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 502 } },
            },
          },
        })
        return
      }
      if (text.includes('子智能体审批')) {
        // 子智能体在自己的线程和轮次里请求审批
        pending = 'approve'
        out({
          id: 'approve',
          method: 'item/commandExecution/requestApproval',
          params: { threadId: 'fake-sub-thread', turnId: 'sub-turn-1', itemId: 'sub-cmd', command: 'npm test' },
        })
        return
      }
      if (text.includes('审批')) {
        pending = 'approve'
        out({
          id: 'approve',
          method: 'item/commandExecution/requestApproval',
          params: { threadId: thread, turnId: id, itemId: 'cmd-1', command: 'echo test', reason: 'Test approval' },
        })
        return
      }
      if (!turn.slow) turn.timer = setTimeout(() => finish(), text.includes('慢') ? 1800 : 50)
      break
    }
    case 'turn/steer':
      if (!turn || turn.id !== p.expectedTurnId) {
        out({ id: m.id, error: { code: -32000, message: 'turn mismatch' } })
        break
      }
      emit('item/started', {
        threadId: thread,
        turnId: turn.id,
        item: { type: 'userMessage', id: 'steer-' + next, clientId: p.clientUserMessageId, content: p.input },
      })
      turn.text +=
        ' ' +
        p.input
          .filter(i => i.type === 'text')
          .map(i => i.text)
          .join(' ')
      response(m, { turnId: turn.id })
      break
    case 'turn/interrupt': {
      response(m, {})
      const current = turn
      if (current?.slow) setTimeout(() => turn === current && finish('interrupted'), 1000)
      else finish('interrupted')
      break
    }
    case 'thread/compact/start':
      turn = { id: 'compact-' + ++next, item: 'compact-item-' + next, text: 'Compacted', timer: null }
      emit('turn/started', { threadId: thread, turn: { id: turn.id, status: 'inProgress' } })
      emit('item/started', { threadId: thread, turnId: turn.id, item: { type: 'contextCompaction', id: turn.item } })
      response(m, {})
      setTimeout(() => finish(), 50)
      break
    default:
      out({ id: m.id, error: { code: -32601, message: 'Unknown method ' + m.method } })
  }
})
process.stdin.on('end', () => process.exit(0))
