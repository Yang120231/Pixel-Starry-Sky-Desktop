import { tr } from '../../i18n/core'
import type { ContextWindow } from '@pixelsky/protocol'

export function contextPercentage(context: ContextWindow | null | undefined): number | null {
  if (!context || context.stale || context.used === null || context.window === null || context.window <= 0 || !Number.isFinite(context.used) || !Number.isFinite(context.window)) return null
  return context.used / context.window * 100
}
export function contextNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1000000) return `${Number((value / 1000000).toFixed(2))}m`
  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}k`
  return value.toLocaleString('zh-CN')
}
const LABELS: Record<string, string> = {
  get 'System prompt'() { return tr("session.contextData.message140") }, get 'System tools'() { return tr("session.contextData.message141") }, get 'MCP tools'() { return tr("session.contextData.message142") }, get 'Memory files'() { return tr("session.contextData.message143") }, get 'Custom agents'() { return tr("session.contextData.message144") }, get 'Agents'() { return tr("session.contextData.message145") }, 'Skills': 'Skills', get 'Messages'() { return tr("session.contextData.message146") }, get 'Conversation'() { return tr("session.contextData.message146") }, get 'Autocompact buffer'() { return tr("session.contextData.message147") }, get 'Free space'() { return tr("session.contextData.message148") },
}
export const contextLabel = (name: string): string => LABELS[name] ?? name
export interface ContextSegment { name: string; tokens: number; kind: 'used' | 'buffer' | 'free'; color: string }
const COLORS = ['bg-chart-input', 'bg-chart-output', 'bg-chart-cache', 'bg-accent', 'bg-warn', 'bg-ultracode']
export function contextSegments(context: ContextWindow | null | undefined): ContextSegment[] {
  if (!context || context.stale || context.used === null || !context.window) return []
  if (context.diagnostic && !context.diagnosticStale) return context.diagnostic.categories.map((c, i) => ({ ...c, name: contextLabel(c.name), color: c.kind === 'free' ? 'bg-fg-faint/30' : c.kind === 'buffer' ? 'bg-warn' : COLORS[i % COLORS.length] }))
  const data: ContextSegment[] = [
    { get name() { return tr("session.contextData.message149") }, tokens: context.input ?? 0, kind: 'used', color: 'bg-chart-input' },
    { get name() { return tr("session.contextData.message150") }, tokens: context.cacheRead ?? 0, kind: 'used', color: 'bg-chart-cache' },
    { get name() { return tr("session.contextData.message151") }, tokens: context.cacheWrite ?? 0, kind: 'used', color: 'bg-chart-output' },
    { get name() { return tr("session.contextData.message152") }, tokens: Math.max(0, context.window - context.used), kind: 'free', color: 'bg-fg-faint/30' },
  ]
  return data.filter(s => s.tokens > 0)
}
