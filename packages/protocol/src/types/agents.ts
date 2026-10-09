/** 后台任务（后台命令、多智能体编排、监视任务等） */
export interface BackgroundTask {
  id: string
  /** CLI 的任务类型：local_workflow / local_bash / local_agent / monitor … */
  kind: string
  description: string
  /** 最新进度（一句话），没有时为 null */
  message: string | null
}

/** 子智能体条上的一项 */
export interface SubagentStatus {
  id: string
  label: string
  /** running / completed / failed / stopped */
  status: string
  /** 最新进度（摘要或正在用的工具） */
  message: string | null
}

/** 智能体追踪里的一个智能体（编排里的智能体，或 Agent 工具派出的子智能体） */
export interface AgentRun {
  /** 还在排队的编排智能体可能还没有 id（空字符串） */
  id: string
  label: string
  /** 子智能体类型（general-purpose 等），编排智能体没有 */
  type: string
  model: string
  /** 原始状态词，界面统一归成 运行中 / 已完成 / 失败 / 已停止 / 排队中 */
  state: string
  /** 毫秒时间戳；不知道时为 0 */
  startedAt: number
  durationMs: number
  tokens: number
  toolCalls: number
  /** 所属阶段（编排智能体） */
  phase: number | null
  /** 任务说明的开头 */
  prompt: string
  /** 结果的开头 */
  result: string
  /** 派出它的工具调用 id（Agent 工具） */
  toolUseId: string | null
}

/** 一次多智能体编排（Workflow） */
export interface WorkflowRun {
  id: string
  name: string
  description: string
  status: string
  startedAt: number
  durationMs: number
  tokens: number
  toolCalls: number
  phases: { index: number; title: string }[]
  agents: AgentRun[]
  /** 启动它的工具调用 id（Workflow 工具） */
  toolUseId: string | null
}

export interface AgentRuns {
  workflows: WorkflowRun[]
  agents: AgentRun[]
}

/** 后台任务的输出（只给最后一段） */
export interface TaskOutput {
  output: string
  truncated: boolean
}
