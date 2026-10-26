// 加项目（docs/mobile-remote.md §18.3、§26）：在手机上翻电脑上的文件夹，选一个加成项目。只在这台电脑上，
// 不经 SSH 机器；只有「可操作」的手机能用。从最近那个项目的上一级开始，也可以直接输入路径。
// 文件夹列表是灰色圆角分组（强调色文件夹图标 + 箭头），底部一个药丸主按钮「加为项目」。
import { useState } from 'react'
import { CornerLeftUp, Folder, FolderPlus } from 'lucide-react'
import type { ProjectRecord } from '@pixelsky/protocol'
import { callTool, toolError, useToolData, type DirectoryChoices } from '@/data/tools'
import { L } from '@/i18n'
import { Banner, Button, Empty, Row, Screen, Section, Spinner } from '@/ui'
import { SearchField } from '@/ui/search'

/** 路径的最后一段 */
const baseName = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path

export function AddProject({
  deviceId,
  start,
  existing,
  onBack,
  onAdded,
}: {
  deviceId: string
  /** 从哪个目录开始；null 时从电脑上的用户主目录开始 */
  start: string | null
  /** 已经是项目的目录（标出来、不能再加） */
  existing: readonly ProjectRecord[]
  onBack(): void
  onAdded(project: ProjectRecord): void
}) {
  const [path, setPath] = useState<string | null>(start)
  const [typed, setTyped] = useState('')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = useToolData<DirectoryChoices>(deviceId, 'directories', path ? [path] : [])
  const dir = list.data
  const same = (a: string, b: string) =>
    a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
  const already = dir ? existing.find(p => same(p.path, dir.path)) : undefined
  const sep = dir?.path.includes('\\') ? '\\' : '/'
  const child = (name: string) => (dir ? dir.path.replace(/[\\/]+$/, '') + sep + name : name)
  const shown = dir?.directories.filter(d => !filter.trim() || d.toLowerCase().includes(filter.trim().toLowerCase()))

  const add = async () => {
    if (!dir) return
    setBusy(true)
    setError(null)
    try {
      onAdded(await callTool<ProjectRecord>(deviceId, 'addProject', dir.path))
    } catch (e) {
      setError(toolError(e))
      setBusy(false)
    }
  }

  return (
    <Screen
      title={L('添加项目', 'Add project')}
      subtitle={L('选电脑上的一个文件夹', 'Choose a folder on your computer')}
      onBack={onBack}
      footer={
        <div className="px-4 pt-1 pb-2">
          <Button
            variant="primary"
            className="w-full rounded-full! min-h-11!"
            disabled={!dir || busy || !!already}
            onClick={() => void add()}
          >
            {busy ? <Spinner size={16} /> : <FolderPlus size={18} />}
            {already
              ? L(`「${already.name}」已经是项目`, `“${already.name}” is already a project`)
              : dir
                ? L(`把「${baseName(dir.path)}」加为项目`, `Add “${baseName(dir.path)}” as a project`)
                : L('加为项目', 'Add as project')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pt-2 pb-6">
        <form
          className="flex items-center gap-2 px-4"
          onSubmit={e => {
            e.preventDefault()
            if (typed.trim()) {
              setPath(typed.trim())
              setTyped('')
              setFilter('')
            }
          }}
        >
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={dir?.path ?? L('输入文件夹路径', 'Enter a folder path')}
            enterKeyHint="go"
            spellCheck={false}
            autoCapitalize="off"
            className="min-h-11 min-w-0 flex-1 rounded-full border border-line-subtle bg-surface px-4 font-mono text-meta outline-none focus:border-line-composer-focus"
          />
          <Button size="sm" type="submit" className="rounded-full! min-h-11! px-4!" disabled={!typed.trim()}>
            {L('前往', 'Go')}
          </Button>
        </form>
        {(error ?? list.error) && <Banner tone="danger">{error ?? list.error}</Banner>}
        {!dir ? (
          !list.error && (
            <div className="flex items-center justify-center gap-2 py-16 text-meta text-fg-muted">
              <Spinner /> {L('正在读取…', 'Loading…')}
            </div>
          )
        ) : (
          <>
            <div className="truncate px-5 font-mono text-meta text-fg-muted" dir="rtl" title={dir.path}>
              {dir.path}
            </div>
            {dir.directories.length > 12 && (
              <SearchField value={filter} onChange={setFilter} placeholder={L('筛选文件夹', 'Filter folders')} />
            )}
            <Section>
              {dir.parent && (
                <Row
                  onClick={() => {
                    setPath(dir.parent)
                    setFilter('')
                  }}
                  icon={<CornerLeftUp size={18} />}
                  title={<span className="text-fg-secondary">{L('上一级', 'Up one level')}</span>}
                />
              )}
              {shown?.map(name => {
                const project = existing.find(p => same(p.path, child(name)))
                return (
                  <Row
                    key={name}
                    onClick={() => {
                      setPath(child(name))
                      setFilter('')
                    }}
                    icon={<Folder size={20} strokeWidth={1.75} className="text-accent-fg" />}
                    title={<span className="block truncate">{name}</span>}
                    trailing={
                      project && (
                        <span className="shrink-0 text-label text-fg-faint">{L('已是项目', 'Already a project')}</span>
                      )
                    }
                    chevron
                  />
                )
              })}
              {!dir.directories.length && <Empty icon={Folder} title={L('没有子文件夹', 'No subfolders')} />}
            </Section>
          </>
        )}
      </div>
    </Screen>
  )
}
