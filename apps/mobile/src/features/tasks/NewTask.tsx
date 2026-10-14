// 新建任务：选项目、引擎，写第一句话（可以带图片）。引擎默认用电脑上设的那个（docs/mobile-remote.md §17 第 7 项）；
// 权限模式、线路、模型都用电脑上的设置（手机传了也会被电脑忽略，D095）。
import { useRef, useState } from 'react'
import { Check, Folder, Send } from 'lucide-react'
import { ENGINES, ENGINE_ORDER, type EngineId, type SessionRecord } from '@pixelsky/protocol'
import type { Pairing } from '@/connection'
import { useDefaultEngine, useDesktop } from '@/data/hooks'
import { imageDataUrl, usePendingImages } from '@/data/images'
import { attemptFor, sendKey, type SendAttempt } from '@/data/retry'
import { Banner, Button, Empty, Screen, Section, Segmented, Spinner, cn } from '@/ui'
import { AttachButton, AttachmentStrip } from '@/ui/images'

export function NewTask({
  pairing,
  initialProject,
  initialText = '',
  onBack,
  onCreated,
}: {
  pairing: Pairing
  /** 在哪个项目里新建（抽屉里点的项目、当前项目） */
  initialProject?: string | null
  /** 输入框里先放好的（任务「交给 AI」） */
  initialText?: string
  onBack(): void
  onCreated(sessionId: string): void
}) {
  const { link, state, projects, loaded } = useDesktop(pairing.deviceId)
  const defaultEngine = useDefaultEngine(pairing.deviceId)
  const [projectId, setProjectId] = useState<string | null>(initialProject ?? null)
  // 没选过就跟电脑上的默认引擎；电脑版太旧拿不到时用 Claude
  const [picked, setPicked] = useState<EngineId | null>(null)
  const engine = picked ?? defaultEngine ?? 'claude'
  const [text, setText] = useState(initialText)
  const images = usePendingImages()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = (projects.some(p => p.id === projectId) ? projectId : null) ?? projects[0]?.id ?? null
  const hasContent = !!text.trim() || images.images.length > 0

  // 上次建好了会话、但消息没发成功：重试时不再新建会话，消息沿用同一个 ID（data/retry.ts）
  const created = useRef<{ key: string; sessionId: string } | null>(null)
  const attempt = useRef<SendAttempt | null>(null)
  const create = async () => {
    if (!link || !chosen || !hasContent) return
    setBusy(true)
    setError(null)
    const value = text.trim()
    const ids = images.images.map(i => i.id)
    const target = JSON.stringify([chosen, engine])
    try {
      if (created.current?.key !== target) {
        const record = await link.call<SessionRecord>('engine:createSession', { projectId: chosen, engine })
        created.current = { key: target, sessionId: record.id }
      }
      const sessionId = created.current.sessionId
      const current = attemptFor(attempt.current, sendKey(sessionId, value, ids), () => crypto.randomUUID())
      attempt.current = current
      await link.call('engine:send', sessionId, {
        text: value,
        clientMessageId: current.id,
        ...(images.images.length ? { attachments: images.images } : {}),
      })
      created.current = null
      attempt.current = null
      onCreated(sessionId)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen
      title="新建会话"
      onBack={onBack}
      footer={
        <div className="border-t border-line-subtle p-3">
          <Button
            variant="primary"
            className="w-full"
            disabled={busy || images.busy || state !== 'ready' || !chosen || !hasContent}
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
            <div className="flex items-end gap-1 border-t border-line-subtle px-2 pt-1.5 pb-1">
              <AttachButton disabled={busy} onFiles={files => void images.add(files)} />
              <div className="min-w-0 flex-1">
                {images.images.length || images.busy ? (
                  <AttachmentStrip
                    images={images.images.map(i => ({ id: i.id, src: imageDataUrl(i) }))}
                    busy={images.busy}
                    onRemove={images.remove}
                  />
                ) : (
                  <span className="block py-2.5 text-meta text-fg-faint">可以加截图或照片</span>
                )}
              </div>
            </div>
          </Section>
          {images.error && <Banner tone="danger">{images.error}</Banner>}
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
              onChange={setPicked}
            />
            <p className="mt-2 px-1 text-label text-fg-faint">
              {defaultEngine && !picked ? '默认用电脑上设的引擎。' : ''}模型、权限模式和线路用电脑上的设置。
            </p>
          </div>
          {error && <Banner tone="danger">{error}</Banner>}
        </div>
      )}
    </Screen>
  )
}
