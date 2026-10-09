import type { TaskState, EnvironmentState, ProjectCopy } from '../../../preload/project-tools'
import type { BrowserState } from '../../../preload/project-browser'
export const demoToolTasks: TaskState = {
  tasks: [{ id: 'demo-task', projectId: 'demo', title: '检查工作区改动', note: '', status: 'in_progress', priority: 'normal', due: '', tags: [], order: 0, createdAt: 0, updatedAt: 0 }],
  plans: [{ sessionId: 'demo-plan', title: '当前会话计划', item: { id: 'demo-plan-item', kind: 'todo', status: 'completed', steps: [{ text: '检查项目结构', status: 'completed' }, { text: '完成界面调整', status: 'in_progress' }, { text: '运行验证', status: 'pending' }] } }],
}
export const demoToolEnvironment: EnvironmentState = {
  projectId: 'demo', projectPath: 'D:/pixel-web', gitRoot: 'D:/pixel-web', branch: 'main', commit: 'a1b2c3d', dirty: false, checkedAt: 0,
  tools: ['git', 'node', 'pnpm'].map((name, i) => ({ name, version: ['2.47.0', 'v22.14.0', '10.10.0'][i], path: name, expected: null, status: 'ready', checkedAt: 0 })),
  services: [], scripts: { dev: 'vite' },
}
export const demoToolCopies: ProjectCopy[] = [{ id: 'demo-copy', projectId: 'demo', name: 'review-ui', path: 'D:/pixel-web-copies/review-ui', branch: 'pixelsky/review-ui', baseCommit: 'a1b2c3d', baseBranch: 'main', createdAt: 0, updatedAt: 0, dirty: false, changedCount: 0, ahead: 0, behind: 0, sessions: [], error: null }]
export const demoToolBrowser: BrowserState = { scope: 'demo', activeId: 'demo-web', pages: [{ id: 'demo-web', url: 'http://127.0.0.1:8330/', title: 'pixel-web', loading: false, error: null, canBack: false, canForward: false, annotations: [] }] }
