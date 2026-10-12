// 添加电脑：能扫码就扫，不能（没相机、微信里、局域网 http）或扫不了（二维码就在本机屏幕上）就粘贴配对链接。
// 粘贴的文字交给 findOffer 找出链接；成功后和扫码一样进配对页。
import { useState } from 'react'
import { ClipboardPaste, Link2, ScanLine } from 'lucide-react'
import { findOffer, type Offer } from '@/connection'
import { Banner, Button, Screen, Section } from '@/ui'
import { canScan } from './ScanScreen'

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
      else setError('剪贴板里没有内容。先在电脑上复制配对链接。')
    } catch {
      setError('浏览器不让读剪贴板。长按上面的输入框，选「粘贴」就行。')
    }
  }

  return (
    <Screen title="添加电脑" onBack={onBack}>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6 py-4">
        {scan && (
          <div className="px-4">
            <Button variant="primary" onClick={onScan} className="w-full">
              <ScanLine size={18} /> 扫码
            </Button>
            <p className="mt-2 text-center text-meta text-fg-muted">用这台设备的相机扫电脑屏幕上的二维码</p>
          </div>
        )}

        <Section title="粘贴配对链接">
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
            aria-label="配对链接"
            placeholder="把电脑上复制的配对链接粘贴到这里"
            className="block min-h-28 w-full resize-none bg-transparent px-4 py-3.5 text-prose text-fg outline-none placeholder:text-fg-faint"
          />
        </Section>
        {error && (
          <div role="alert">
            <Banner tone="danger">{error}</Banner>
          </div>
        )}
        <div className="flex flex-col gap-3 px-4">
          <Button variant={scan ? 'secondary' : 'primary'} disabled={!text.trim()} onClick={() => submit(text)}>
            <Link2 size={18} /> 连接
          </Button>
          {canPaste && (
            <Button variant="secondary" onClick={() => void paste()}>
              <ClipboardPaste size={18} /> 从剪贴板粘贴
            </Button>
          )}
        </div>

        <div className="px-5 text-meta text-fg-muted">
          <div className="pb-1.5 font-medium text-fg-secondary">怎么拿到配对链接</div>
          <ol className="flex list-decimal flex-col gap-1 pl-4">
            <li>在电脑上打开像素星空 › 设置 › 手机 › 添加手机。</li>
            <li>点「复制配对链接」，发到这台设备上，粘贴到上面的输入框。</li>
            <li>不要直接点开这个链接：谁打开了链接，就是谁被配对。</li>
          </ol>
          <p className="pt-2">
            手机想省事，也可以直接用手机相机或微信扫电脑屏幕上的二维码，会自动配对，不用粘贴。链接 5
            分钟内有效，只能用一次。
          </p>
        </div>
      </div>
    </Screen>
  )
}
