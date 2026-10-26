// 添加电脑：能扫码就扫，不能（没相机、微信里、局域网 http）或扫不了（二维码就在本机屏幕上）就粘贴配对链接。
// 粘贴的文字交给 findOffer 找出链接；成功后和扫码一样进配对页。
// iOS 样子（§26）：居中的标题和说明、虚线二维码框（能扫码时）、整行宽的胶囊键（扫二维码 / 连接 / 粘贴配对链接）。
import { useState } from 'react'
import { Camera, Link2, QrCode } from 'lucide-react'
import { findOffer, type Offer } from '@/connection'
import { Banner, Button, Screen, Section } from '@/ui'
import { canScan } from './ScanScreen'
import { L } from '@/i18n'

export function AddComputer({
  onBack,
  onScan,
  onOffer,
}: {
  onBack(): void
  onScan(): void
  onOffer(offer: Offer): void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scan = canScan()
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText

  const submit = (value: string) => {
    try {
      onOffer(findOffer(value))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText()
      setText(clip)
      if (clip.trim()) submit(clip)
      else
        setError(
          L(
            '剪贴板里没有内容。先在电脑上复制配对链接。',
            'The clipboard is empty. Copy the pairing link on your computer first.',
          ),
        )
    } catch {
      setError(
        L(
          '浏览器不让读剪贴板。长按上面的输入框，选「粘贴」就行。',
          'The browser won’t let us read the clipboard. Long-press the box above and choose “Paste”.',
        ),
      )
    }
  }

  return (
    <Screen title={L('添加电脑', 'Add a computer')} onBack={onBack} close>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5 py-2">
        <div className="px-6 text-center">
          <h2 className="text-section font-semibold">{L('连上你的电脑', 'Connect to your computer')}</h2>
          <p className="mt-1.5 text-meta text-fg-muted">
            {L(
              '在电脑上打开 像素星空 › 设置 › 手机 › 添加手机，扫那里的二维码，或粘贴配对链接',
              'On your computer open PixelSky › Settings › Phone › Add a phone, then scan the QR code there or paste the pairing link',
            )}
          </p>
        </div>
        {scan && (
          <div className="flex flex-col items-center gap-4 px-4">
            <div
              aria-hidden
              className="flex size-32 items-center justify-center rounded-[28px] border-2 border-dashed border-line-strong text-fg-faint"
            >
              <QrCode size={56} strokeWidth={1.2} />
            </div>
            <Button variant="primary" onClick={onScan} className="min-h-11! w-full rounded-full!">
              <Camera size={18} /> {L('扫二维码', 'Scan QR code')}
            </Button>
          </div>
        )}

        <Section title={L('配对链接', 'Pairing link')}>
          <textarea
            value={text}
            onChange={e => {
              setText(e.target.value)
              setError(null)
            }}
            rows={4}
            autoFocus={!scan}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={L('配对链接', 'Pairing link')}
            placeholder={L('把电脑上复制的配对链接粘贴到这里', 'Paste the pairing link copied on your computer here')}
            className="block min-h-28 w-full resize-none bg-transparent px-4 py-3.5 text-prose text-fg outline-none placeholder:text-fg-faint"
          />
        </Section>
        {error && (
          <div role="alert">
            <Banner tone="danger">{error}</Banner>
          </div>
        )}
        <div className="flex flex-col gap-2.5 px-4">
          <Button
            variant={scan ? 'secondary' : 'primary'}
            disabled={!text.trim()}
            onClick={() => submit(text)}
            className="min-h-11! rounded-full!"
          >
            {L('连接', 'Connect')}
          </Button>
          {canPaste && (
            <Button variant="secondary" onClick={() => void paste()} className="min-h-11! rounded-full!">
              <Link2 size={18} /> {L('粘贴配对链接', 'Paste pairing link')}
            </Button>
          )}
        </div>

        <div className="px-5 text-meta text-fg-muted">
          <div className="pb-1.5 font-medium text-fg-secondary">
            {L('怎么拿到配对链接', 'How to get a pairing link')}
          </div>
          <ol className="flex list-decimal flex-col gap-1 pl-4">
            <li>
              {L(
                '在电脑上打开像素星空 › 设置 › 手机 › 添加手机。',
                'On your computer, open PixelSky › Settings › Phone › Add a phone.',
              )}
            </li>
            <li>
              {L(
                '点「复制配对链接」，发到这台设备上，粘贴到上面的输入框。',
                'Click “Copy pairing link”, send it to this device and paste it into the box above.',
              )}
            </li>
            <li>
              {L(
                '不要直接点开这个链接：谁打开了链接，就是谁被配对。',
                'Don’t open the link directly: whoever opens it is the one that gets paired.',
              )}
            </li>
          </ol>
          <p className="pt-2">
            {L(
              '手机想省事，也可以直接用手机相机或微信扫电脑屏幕上的二维码，会自动配对，不用粘贴。链接 5 分钟内有效，只能用一次。',
              'On a phone, it’s easier to scan the QR code on your computer screen with the camera or WeChat — it pairs automatically, no pasting needed. The link is valid for 5 minutes and works only once.',
            )}
          </p>
        </div>
      </div>
    </Screen>
  )
}
