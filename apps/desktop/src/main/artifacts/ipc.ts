// 产物面板（docs/ui/artifacts-panel.md）：用默认应用打开 / 在文件夹中显示。只限本机，只限 AI 改动记录里的文件。
// 列表、改动和预览读取是本机与远端共用的引擎操作（core/engine/ops.ts）
import { shell } from 'electron'
import type { EngineHost } from '@pixelsky/engine'
import * as ipc from '../ipc/guard'
import { artifactRef } from '../core/args'
import { openable } from '../core/artifact-files'
import { machineOf } from '../machines/identity'

export function initArtifacts(host: EngineHost): void {
  for (const action of ['open', 'reveal'] as const)
    ipc.handle(`artifacts:${action}`, async (_event, input) => {
      const v = artifactRef(input)
      if (machineOf(v.sessionId) !== 'local') throw new Error('远程机器上的文件只能预览')
      if (!(await host.recordedPath(v.sessionId, v.path))) throw new Error('只能打开 AI 改动记录里的文件')
      if (action === 'reveal') {
        shell.showItemInFolder(v.path)
        return
      }
      if (!openable(v.path)) throw new Error('出于安全考虑，这类文件不能直接打开')
      const error = await shell.openPath(v.path)
      if (error) throw new Error(error)
    })
}
