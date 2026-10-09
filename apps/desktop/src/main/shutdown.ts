// All window/file/terminal confirmations finish before any registered process is stopped.
const tasks = new Set<() => Promise<void> | void>()
export function registerShutdown(task: () => Promise<void> | void): void {
  tasks.add(task)
}
let pending: Promise<void> | null = null
export function shutdownServices(): Promise<void> {
  return (pending ??= Promise.allSettled([...tasks].map(task => Promise.resolve().then(task))).then(results => {
    for (const result of results) if (result.status === 'rejected') console.error('Shutdown:', result.reason)
  }))
}
