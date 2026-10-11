// 新建任务：选项目、引擎，写第一句话。权限模式、线路、模型都用电脑上的设置（手机传了也会被电脑忽略，D095）。
import { useState } from 'react'
import { Check, Folder, Send } from 'lucide-react'
import { ENGINES, ENGINE_ORDER, type EngineId, type SessionRecord } from '@pixelsky/protocol'
import type { Pairing } from '@/connection'
import { useDesktop } from '@/data/hooks'
import { Banner, Button, Empty, Screen, Section, Segmented, Spinner, cn } from '@/ui'

export function NewTask({
  pairing,
  onBack,
  onCreated,
}: {
  pairing: Pairing
  onBack(): void
  onCreated(sessionId: string): void
}) {
  const { link, state, projects, loaded } = useDesktop(pairing.deviceId)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [engine, setEngine] = useState<EngineId>('claude')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = projectId ?? projects[0]?.id ?? null

  const create = async () => {
    if (!link || !chosen || !text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const record = await link.call<SessionRecord>('engine:createSession', { projectId: chosen, engine })
      await link.call('engine:send', record.id, { text: text.trim(), clientMessageId: crypto.randomUUID() })
      onCreated(record.id)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen
      title="新建任务"
      onBack={onBack}
      footer={
        <div className="border-t border-line-subtle p-3">
          <Button
            variant="primary"
            className="w-full"
            disabled={busy || state !== 'ready' || !chosen || !text.trim()}
            onClick={() => void create()}
          >
            {busy ? <Spinner size={16} /> : <Send size={17} />}
            {busy ? '正在创建…' : '开始'}
          </Button>
        </div>
      }
    >
      {loaded && projects.length === 0 ? (
        <Empty icon={Folder} title="电脑上还没有项目" body="先在电脑上的像素星空里添加一个项目文件夹。" />
      ) : (
        <div className="flex flex-col gap-6 py-4">
          <Section title="要做什么">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={5}
              autoFocus
              placeholder="例如：把登录页的按钮改成圆角，并补上单元测试"
              className="block min-h-32 w-full resize-none bg-transparent px-4 py-3.5 text-prose text-fg outline-none placeholder:text-fg-faint"
            />
          </Section>
          <Section title="项目">
            {projects.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProjectId(p.id)}
                className={cn(
                  'flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-hover',
                  i > 0 && 'border-t border-line-subtle',
                )}
              >
                <Folder size={20} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ui">{p.name}</span>
                  <span className="truncate font-mono text-label text-fg-faint" dir="rtl">
                    {p.path}
                  </span>
                </span>
                {chosen === p.id && <Check size={20} className="shrink-0 text-accent-fg" />}
              </button>
            ))}
          </Section>
          <div className="px-4">
            <div className="px-1 pb-2 text-meta font-medium text-fg-muted">引擎</div>
            <Segmented<EngineId>
              options={ENGINE_ORDER.map(id => ({ value: id, label: ENGINES[id].name }))}
              value={engine}
              onChange={setEngine}
            />
            <p className="mt-2 px-1 text-label text-fg-faint">模型、权限模式和线路用电脑上的设置。</p>
          </div>
          {error && <Banner tone="danger">{error}</Banner>}
        </div>
      )}
    </Screen>
  )
}
