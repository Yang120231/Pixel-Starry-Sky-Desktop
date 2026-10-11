// 演示数据汇总：只由 main.tsx 在演示模式下动态加载，装进 data/demo.ts（docs/restructure.md §9.3）
import type { DemoSource } from '@/data/demo'
import { demoAccount } from './account'
import { demoArtifactChange, demoArtifactPreview, demoArtifacts } from './artifacts'
import { demoContext } from './context'
import { animateCompaction, showcaseSnapshots, showcaseSubagentTranscript, showcaseTaskOutput } from './conversations'
import { workbenchSnapshots } from './workbench'
import { demo } from './demo'
import { DEMO_EDITOR_STATE, DEMO_FILES, demoDirectory, demoDocument } from './files'
import { demoGitBranches, demoGitDiff, demoGitHistory, demoGitStatus } from './git'
import { demoInbox } from './inbox'
import { demoEngineCatalog, demoEngineConfig, demoEngineStatus, demoPlatformGroups, demoProviders } from './platform'
import { demoToolBrowser, demoToolCopies, demoToolEnvironment, demoToolTasks } from './projectTools'
import { demoRemoteCalls } from './remoteCalls'
import { demoSearchProjects, searchDemo } from './search'
import { demoSessions } from './sessionLifecycle'
import { demoRewindPreview, demoSideAnswer } from './branch'
import { demoTerminalOutput, demoTerminalProfiles } from './terminal'
import { demoUsageRecords } from './usage'

export const demoSource: DemoSource = {
  appData: demo,
  account: demoAccount,
  platformGroups: demoPlatformGroups,
  providers: demoProviders,
  engines: { status: demoEngineStatus, catalog: demoEngineCatalog, config: demoEngineConfig },
  artifacts: { response: demoArtifacts, change: demoArtifactChange, preview: demoArtifactPreview },
  context: demoContext,
  files: { contents: DEMO_FILES, editorState: DEMO_EDITOR_STATE, directory: demoDirectory, document: demoDocument },
  git: { status: demoGitStatus, branches: demoGitBranches, diff: demoGitDiff, history: demoGitHistory },
  inbox: demoInbox,
  projectTools: {
    tasks: demoToolTasks,
    environment: demoToolEnvironment,
    copies: demoToolCopies,
    browser: demoToolBrowser,
  },
  remoteCalls: demoRemoteCalls,
  usageRecords: demoUsageRecords,
  search: { projects: demoSearchProjects, run: searchDemo },
  terminal: { profiles: demoTerminalProfiles, output: demoTerminalOutput },
  sessions: demoSessions,
  conversations: {
    snapshots: { ...showcaseSnapshots, ...workbenchSnapshots },
    subagentTranscript: showcaseSubagentTranscript,
    taskOutput: showcaseTaskOutput,
    rewindPreview: demoRewindPreview,
    sideAnswer: demoSideAnswer,
    animate: animateCompaction,
  },
}
