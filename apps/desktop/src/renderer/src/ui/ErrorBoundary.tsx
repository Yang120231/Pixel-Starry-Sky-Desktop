// 局部错误边界（docs/ui/renderer-memory.md §3.1.7）：一个标签里的界面出错时只有这一块显示提示，其他标签、整个窗口照常
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { tr } from '@/i18n/core'
import { Button } from './Button'

/** resetKeys 是否变了（长度或任一项 Object.is 不等） */
export function resetKeysChanged(prev: readonly unknown[] = [], next: readonly unknown[] = []): boolean {
  return prev.length !== next.length || prev.some((v, i) => !Object.is(v, next[i]))
}

interface Props {
  children: ReactNode
  /** 自定义兜底；不传用默认的居中提示 */
  fallback?: (error: unknown, reset: () => void) => ReactNode
  /** 这些值变了就清掉错误重新挂载子树（如标签、会话 id） */
  resetKeys?: unknown[]
  /** 写进日志，区分是哪个边界 */
  label?: string
  /** 捕获到错误时回调（上报日志由调用方做，ui/ 不依赖 features/） */
  onError?: (error: unknown, componentStack: string | undefined, label: string | undefined) => void
}

interface State {
  error: unknown
  hasError: boolean
}

/** 子树渲染出错时只在这块区域显示提示，不让整个 React 根卸载白屏 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false }

  static getDerivedStateFromError(error: unknown): State {
    return { error, hasError: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const componentStack = info.componentStack
      ? info.componentStack.trim().split('\n').slice(0, 8).join('\n')
      : undefined
    this.props.onError?.(error, componentStack, this.props.label)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.hasError && resetKeysChanged(prev.resetKeys, this.props.resetKeys)) this.reset()
  }

  reset = () => this.setState({ error: null, hasError: false })

  render() {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
    return (
      <div role="alert" className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <TriangleAlert size={28} strokeWidth={1.5} className="text-fg-faint" />
        <div className="text-section font-medium text-fg">{tr('recovery.boundary.title')}</div>
        <div className="max-w-sm text-ui text-fg-muted">{tr('recovery.boundary.body')}</div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={this.reset}>
            {tr('recovery.boundary.retry')}
          </Button>
          <Button onClick={() => location.reload()}>{tr('recovery.boundary.reload')}</Button>
        </div>
      </div>
    )
  }
}
