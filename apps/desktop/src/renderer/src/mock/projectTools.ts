import type { TaskState, EnvironmentState, ProjectCopy, RunTaskState } from '../../../shared/types/project-tools'
import type { BrowserState } from '../../../shared/types/project-browser'
export const demoToolTasks: TaskState = {
  tasks: [
    {
      id: 'demo-task',
      projectId: 'demo',
      title: '检查工作区改动',
      note: '',
      status: 'in_progress',
      priority: 'normal',
      due: '',
      tags: [],
      order: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  plans: [
    {
      sessionId: 'demo-plan',
      title: '当前会话计划',
      item: {
        id: 'demo-plan-item',
        kind: 'todo',
        status: 'completed',
        steps: [
          { text: '检查项目结构', status: 'completed' },
          { text: '完成界面调整', status: 'in_progress' },
          { text: '运行验证', status: 'pending' },
        ],
      },
    },
  ],
}
export const demoToolEnvironment: EnvironmentState = {
  projectId: 'demo',
  projectPath: 'D:/pixel-web',
  gitRoot: 'D:/pixel-web',
  branch: 'main',
  commit: 'a1b2c3d',
  dirty: false,
  checkedAt: 0,
  tools: ['git', 'node', 'pnpm'].map((name, i) => ({
    name,
    version: ['2.47.0', 'v22.14.0', '10.10.0'][i],
    path: name,
    expected: null,
    status: 'ready',
    checkedAt: 0,
  })),
  services: [
    {
      id: 'demo-service-dev',
      projectId: 'demo',
      workspacePath: 'D:/pixel-web',
      name: 'dev 服务',
      command: 'npm run dev',
      cwd: 'D:/pixel-web',
      port: 5173,
      healthUrl: 'http://localhost:5173/',
      envNames: [],
      autoStart: false,
      status: 'running',
      pid: 12840,
      output: [
        '> pixel-web@0.1.0 dev',
        '> vite',
        '',
        '  VITE v6.0.3  ready in 412 ms',
        '',
        '  ➜  Local:   http://localhost:5173/',
        '  ➜  Network: use --host to expose',
      ].join('\n'),
      error: null,
      exitCode: null,
      updatedAt: 0,
      health: 'healthy',
    },
  ],
  scripts: { dev: 'vite' },
}
export const demoToolCopies: ProjectCopy[] = [
  {
    id: 'demo-copy',
    projectId: 'demo',
    name: 'review-ui',
    path: 'D:/pixel-web-copies/review-ui',
    branch: 'pixelsky/review-ui',
    baseCommit: 'a1b2c3d',
    baseBranch: 'main',
    createdAt: 0,
    updatedAt: 0,
    dirty: false,
    changedCount: 0,
    ahead: 0,
    behind: 0,
    sessions: [],
    error: null,
  },
]
export const demoToolBrowser: BrowserState = {
  scope: 'demo',
  activeId: 'demo-web',
  pages: [
    {
      id: 'demo-web',
      url: 'http://127.0.0.1:8330/',
      title: 'pixel-web',
      loading: false,
      error: null,
      canBack: false,
      canForward: false,
      annotations: [],
    },
  ],
}

/** 左栏「任务」的演示数据（docs/ui/coding-tasks.md §4）：照示意图的三种文件 */
export const demoToolRunTasks: RunTaskState = {
  root: '/demo/pixel-web',
  truncated: false,
  groups: [
    {
      kind: 'npm',
      file: 'package.json',
      dir: '',
      manager: 'pnpm',
      tasks: [
        { name: 'dev', detail: 'vite', line: 6 },
        { name: 'build', detail: 'tsc -b && vite build', line: 7 },
        { name: 'lint', detail: 'eslint .', line: 8 },
        { name: 'test', detail: 'vitest run', line: 9 },
        { name: 'typecheck', detail: 'tsc --noEmit', line: 10 },
        { name: 'preview', detail: 'vite preview', line: 11 },
      ],
    },
    {
      kind: 'npm',
      file: 'apps/desktop/package.json',
      dir: 'apps/desktop',
      manager: 'pnpm',
      tasks: [
        { name: 'dev', detail: 'electron-vite dev', line: 5 },
        { name: 'build', detail: 'electron-vite build', line: 6 },
      ],
    },
    {
      kind: 'make',
      file: 'Makefile',
      dir: '',
      tasks: [
        { name: 'release', detail: '', line: 3 },
        { name: 'clean', detail: '', line: 7 },
      ],
    },
    {
      kind: 'cargo',
      file: 'src-tauri/Cargo.toml',
      dir: 'src-tauri',
      tasks: [
        { name: 'build', detail: 'cargo build', line: null },
        { name: 'check', detail: 'cargo check', line: null },
        { name: 'test', detail: 'cargo test', line: null },
        { name: 'run', detail: 'cargo run', line: null },
      ],
    },
    // Gradle（docs/ui/coding-tasks.md §9）：android/ 下一个构建，根项目 + :app
    {
      kind: 'gradle',
      file: 'android/build.gradle.kts',
      dir: 'android',
      gradle: {
        buildDir: 'android',
        project: ':',
        name: 'pixel-android',
        wrapper: true,
        stamp: 'demo0001',
        plugin: null,
        gradleVersion: '8.10',
        javaVersion: '17',
        properties: [
          { key: 'org.gradle.jvmargs', value: '-Xmx2048m -Dfile.encoding=UTF-8', line: 1, secret: false },
          { key: 'android.useAndroidX', value: 'true', line: 2, secret: false },
          { key: 'kotlin.code.style', value: 'official', line: 3, secret: false },
          { key: 'RELEASE_STORE_PASSWORD', value: '', line: 4, secret: true },
        ],
      },
      tasks: [
        { name: 'build', detail: '', line: null, category: 'build' },
        { name: 'clean', detail: '', line: null, category: 'build' },
        { name: 'assemble', detail: '', line: null, category: 'build' },
        { name: 'check', detail: '', line: null, category: 'verification' },
        { name: 'dependencies', detail: '', line: null, category: 'help' },
        { name: 'tasks', detail: '', line: null, category: 'help' },
      ],
    },
    {
      kind: 'gradle',
      file: 'android/app/build.gradle.kts',
      dir: 'android/app',
      gradle: {
        buildDir: 'android',
        project: ':app',
        name: ':app',
        wrapper: true,
        stamp: 'demo0001',
        plugin: 'Android',
        gradleVersion: null,
        javaVersion: null,
      },
      tasks: [
        { name: 'assembleDebug', detail: '', line: null, category: 'build' },
        { name: 'assembleRelease', detail: '', line: null, category: 'build' },
        { name: 'bundleRelease', detail: '', line: null, category: 'build' },
        { name: 'installDebug', detail: '', line: null, category: 'install' },
        { name: 'lint', detail: '', line: null, category: 'verification' },
        { name: 'testDebugUnitTest', detail: '', line: null, category: 'verification' },
        { name: 'syncWebAssets', detail: '把 dist/ 复制进 assets', line: 42, category: 'pixel' },
      ],
    },
  ],
}
