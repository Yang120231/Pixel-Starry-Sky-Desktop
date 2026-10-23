// 频道工具 MCP 服务 pixelsky_channel（docs/ui/channels-collab-v2.md §1）：只挂给频道派活的本机会话，
// 让 AI 自己翻频道记录、读讨论串、在串里回复、提议派活，频道允许互相派活时直接交接。
// 实现在 core/channels/service.ts（toolRead 等），HTTP 部分和 pixelsky_threads 一样走 engine/local-mcp.ts，令牌决定调用方是哪个会话。
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { SessionRecord } from '@pixelsky/protocol'
import type { Channels } from '../core/channels/service'
import type { AgentTools } from '../../shared/types/channels'
import { machineOf } from '../machines/identity'
import {
  READ_ONLY,
  integer,
  localMcpHttp,
  toolText as text,
  type LocalMcpEntry,
  type ToolArgs,
} from '../engine/local-mcp'

export const CHANNEL_SERVER_NAME = 'pixelsky_channel'

/** 发消息、派活的工具：不是只读，但只在频道里留记录，不用每次等用户批准 */
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

const TOOLS = [
  {
    name: 'channel_read',
    description:
      '读你所在协作频道主时间线的消息（从旧到新）：真人和 AI 成员的消息、任务卡（谁交给谁、标题、状态）、提议。默认最近 20 条；给 before（某条消息的 id）往前翻。派活时只带了最近几条，要更早的背景时用。',
    inputSchema: {
      type: 'object',
      properties: {
        before: { type: 'string', description: '只读这条消息之前的，不填时读最新的' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '读几条，默认 20' },
      },
    },
    annotations: READ_ONLY,
  },
  {
    name: 'thread_read',
    description:
      '读某张任务卡或某条消息的讨论串：用户的追加要求和留言、别的成员的回复、结果。不给 id 时读你现在这项活的串。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '任务卡或消息的 id（channel_read 给出的），可不填' } },
    },
    annotations: READ_ONLY,
  },
  {
    name: 'channel_reply',
    description:
      '在你现在这项活的讨论串里写一句：进展、发现的问题、想让用户知道的事。只发在串里，不上主时间线、不派活、不 @ 人。最后的结果不用发，做完后会自动发回频道。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1, description: '要写的内容，支持 Markdown' } },
      required: ['text'],
    },
    annotations: WRITE,
  },
  {
    name: 'task_propose',
    description:
      '提议把一项活交给频道里的另一个 AI 成员：频道里出现一张提议卡，用户点「派出去」才派。适合发现了别人更适合做的事。提议后不用等，接着做你自己的活。',
    inputSchema: {
      type: 'object',
      properties: {
        member: { type: 'string', minLength: 1, description: 'AI 成员的名字' },
        request: { type: 'string', minLength: 1, description: '要他做什么，写清楚需要的背景' },
      },
      required: ['member', 'request'],
    },
    annotations: WRITE,
  },
  {
    name: 'task_handover',
    description:
      '直接把一部分活交给频道里的另一个 AI 成员（只有频道打开了「允许 AI 成员互相派活」才能用，否则用 task_propose）。次数算进频道的接力规则，超了会停下等用户放行。交给他后你可以接着做自己的部分。',
    inputSchema: {
      type: 'object',
      properties: {
        member: { type: 'string', minLength: 1, description: 'AI 成员的名字' },
        request: { type: 'string', minLength: 1, description: '要他做什么，写清楚需要的背景' },
      },
      required: ['member', 'request'],
    },
    annotations: WRITE,
  },
].map(tool => ({ ...tool, annotations: { title: tool.name, ...tool.annotations } }))

const INSTRUCTIONS =
  '你是像素星空协作频道里的 AI 成员。channel_read / thread_read 查频道记录；channel_reply 在你这项活的串里写进展；' +
  'task_propose 提议给别的成员派活（用户决定）；频道允许时 task_handover 直接交接。不能删消息、改频道设置、给别的频道发消息。'

const str = (args: ToolArgs, key: string, required = false): string | undefined => {
  const value = args[key]
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`缺少参数 ${key}（字符串）`)
    return undefined
  }
  if (typeof value !== 'string') throw new Error(`参数 ${key} 必须是字符串`)
  return value
}

function mcpServer(channels: () => Channels | null, sessionId: string): Server {
  const server = new Server(
    { name: CHANNEL_SERVER_NAME, version: '1.0.0' },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const c = channels()
      if (!c) return text('频道还没有就绪，稍后再试。', true)
      const args = (request.params.arguments ?? {}) as ToolArgs
      switch (request.params.name) {
        case 'channel_read':
          return text(c.toolRead(sessionId, { before: str(args, 'before'), limit: integer(args, 'limit') }))
        case 'thread_read':
          return text(c.toolThread(sessionId, str(args, 'id')))
        case 'channel_reply':
          return text(await c.toolReply(sessionId, str(args, 'text', true)!))
        case 'task_propose':
          return text(await c.toolPropose(sessionId, str(args, 'member', true)!, str(args, 'request', true)!))
        case 'task_handover':
          return text(await c.toolHandover(sessionId, str(args, 'member', true)!, str(args, 'request', true)!))
        default:
          return text(`没有这个工具：${request.params.name}`, true)
      }
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error), true)
    }
  })
  return server
}

export interface ChannelToolsServer {
  /** 本机的频道会话：成员的扩展设置（跟随全局时 tools 为 null）和频道工具的地址、令牌；不是频道会话时 null */
  forSession(record: SessionRecord): Promise<{ tools: AgentTools | null; entry: LocalMcpEntry | null } | null>
  /** 频道派活的会话（任何机器上的）：会话自己的「做完自动检查」不重复跑，由频道写在任务卡上 */
  ownsSession(sessionId: string): boolean
  close(): void
}

export function channelToolsServer(channels: () => Channels | null): ChannelToolsServer {
  const http = localMcpHttp(sessionId => mcpServer(channels, sessionId))
  return {
    async forSession(record) {
      if (machineOf(record.id) !== 'local') return null
      const member = channels()?.sessionMember(record.id)
      if (!member) return null
      return { tools: member.tools, entry: await http.entry(record.id) }
    },
    ownsSession: sessionId => channels()?.ownsSession(sessionId) ?? false,
    close: () => http.close(),
  }
}
