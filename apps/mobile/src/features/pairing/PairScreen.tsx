// 配对页（docs/mobile-remote.md §4.1、§13.3）：手机相机扫码打开网页版 → 这里显示电脑名和指纹 → 填手机名 → 连接 →
// 等电脑上确认（对一下两边显示的手机指纹）→ 已配对。
import { useState } from 'react'
import { Check, Laptop, Lock, ShieldCheck, Smartphone, X } from 'lucide-react'
import { connections, pairWithOffer, phoneFingerprint, type Offer, type Pairing } from '@/connection'
import { useLinkState } from '@/data/hooks'
import { Banner, Button, Empty, Screen, Section, Spinner, cn } from '@/ui'
import { L } from '@/i18n'

/** 默认手机名：从浏览器信息里猜一个，用户可以改 */
function guessName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  const android = /Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/.exec(ua)
  return android?.[1]?.trim() || L('我的手机', 'My phone')
}

const steps = () => [L('扫码', 'Scan'), L('连接', 'Connect'), L('电脑确认', 'Confirm on computer')]

function Steps({ at }: { at: number }) {
  const labels = steps()
  return (
    <ol className="flex items-center gap-2 px-4">
      {labels.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-label font-semibold',
              i < at
                ? 'bg-primary text-primary-fg'
                : i === at
                  ? 'border-2 border-fg text-fg'
                  : 'border border-line-strong text-fg-faint',
            )}
          >
            {i < at ? <Check size={13} strokeWidth={3} /> : i + 1}
          </span>
          <span className={cn('text-meta', i <= at ? 'text-fg' : 'text-fg-faint')}>{label}</span>
          {i < labels.length - 1 && <span className="h-px flex-1 bg-line" />}
        </li>
      ))}
    </ol>
  )
}

export function PairScreen({ offer, error, onDone }: { offer: Offer | null; error: string | null; onDone(): void }) {
  const [name, setName] = useState(guessName)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(error)
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const state = useLinkState(pairing?.deviceId)
  const current = pairing ? (connections.list().find(p => p.deviceId === pairing.deviceId) ?? pairing) : null

  if (!offer)
    return (
      <Screen title={L('配对', 'Pairing')} onBack={onDone}>
        <Empty
          icon={X}
          title={L('不是有效的配对二维码', 'Not a valid pairing QR code')}
          body={
            failure ??
            L(
              '请在电脑上 设置 › 手机 › 添加手机，重新扫码。',
              'On your computer, go to Settings › Phone › Add a phone and scan again.',
            )
          }
        />
      </Screen>
    )

  const connect = async () => {
    setBusy(true)
    setFailure(null)
    try {
      setPairing(await pairWithOffer(offer, name.trim() || guessName()))
    } catch (e) {
      setFailure((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const step = !current ? 1 : current.status === 'paired' ? 3 : 2

  return (
    <Screen title={L('连接电脑', 'Connect to computer')} onBack={onDone}>
      <div className="flex flex-col gap-6 py-4">
        <Steps at={step} />

        <div className="mx-4 flex flex-col items-center gap-3 rounded-3xl border border-line-subtle bg-surface px-5 py-6 text-center">
          <div className="flex items-center gap-3 text-fg-muted">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-subtle">
              <Smartphone size={24} strokeWidth={1.5} />
            </span>
            <span className="flex items-center gap-1">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className={cn('size-1 rounded-full', current?.status === 'paired' ? 'bg-success' : 'bg-fg-faint')}
                />
              ))}
              <Lock size={14} className="mx-1" />
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className={cn('size-1 rounded-full', current?.status === 'paired' ? 'bg-success' : 'bg-fg-faint')}
                />
              ))}
            </span>
            <span className="flex size-12 items-center justify-center rounded-2xl bg-subtle">
              <Laptop size={24} strokeWidth={1.5} />
            </span>
          </div>
          <div>
            <div className="text-section font-semibold">{offer.desktopName}</div>
            <div className="mt-1 font-mono text-meta text-fg-muted">
              {L('电脑指纹', 'Computer fingerprint')} {offer.fingerprint}
            </div>
          </div>
        </div>

        {!current ? (
          <>
            {offer.expired && (
              <Banner tone="danger">
                {L(
                  '二维码已过期，请在电脑上重新生成。',
                  'The QR code has expired. Generate a new one on your computer.',
                )}
              </Banner>
            )}
            <Section title={L('这部手机的名字（电脑上会显示）', 'Name of this phone (shown on your computer)')}>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={64}
                className="block min-h-13 w-full bg-transparent px-4 text-ui text-fg outline-none"
              />
            </Section>
            {failure && <Banner tone="danger">{failure}</Banner>}
            <div className="flex flex-col gap-3 px-4">
              <Button variant="primary" disabled={busy || offer.expired} onClick={() => void connect()}>
                {busy && <Spinner size={16} />}
                {busy ? L('正在连接…', 'Connecting…') : L('连接这台电脑', 'Connect to this computer')}
              </Button>
              <p className="flex items-start gap-2 text-meta text-fg-muted">
                <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                {L(
                  '连上后，这部手机能看到电脑上的所有会话，能审批、发消息。内容端到端加密，中转服务器看不到。',
                  'Once connected, this phone can see every conversation on your computer, approve requests and send messages. Everything is end-to-end encrypted; the relay server can’t read it.',
                )}
              </p>
            </div>
          </>
        ) : current.status === 'paired' ? (
          <div className="flex flex-col items-center gap-4 px-4">
            <div className="flex items-center gap-2 text-section font-semibold text-success">
              <ShieldCheck size={22} /> {L('已配对', 'Paired')}
            </div>
            <Button variant="primary" className="w-full" onClick={onDone}>
              {L('开始使用', 'Get started')}
            </Button>
          </div>
        ) : current.status === 'removed' ? (
          <div className="flex flex-col gap-3 px-4">
            <Banner tone="danger">{L('电脑上拒绝了这次连接。', 'The computer declined this connection.')}</Banner>
            <Button
              onClick={() => {
                connections.forget(current.deviceId)
                onDone()
              }}
            >
              {L('返回', 'Back')}
            </Button>
          </div>
        ) : (
          <div className="mx-4 flex flex-col gap-3 rounded-2xl bg-subtle p-4">
            <div className="flex items-center gap-2 text-ui font-medium">
              <Spinner size={15} />
              {state === 'desktop_offline'
                ? L('电脑不在线', 'Computer offline')
                : L('请在电脑上点「允许」', 'Click “Allow” on your computer')}
            </div>
            <p className="text-meta text-fg-muted">
              {state === 'desktop_offline'
                ? L(
                    '打开电脑上的像素星空，设置 › 手机 保持打开。',
                    'Open PixelSky on your computer and keep Settings › Phone open.',
                  )
                : L(
                    '电脑上会显示这部手机的指纹，核对是否一致：',
                    'Your computer will show this phone’s fingerprint. Check that they match:',
                  )}
            </p>
            <div className="self-start rounded-lg bg-surface px-3 py-1.5 font-mono text-ui tracking-wide">
              {phoneFingerprint(current)}
            </div>
          </div>
        )}
      </div>
    </Screen>
  )
}
