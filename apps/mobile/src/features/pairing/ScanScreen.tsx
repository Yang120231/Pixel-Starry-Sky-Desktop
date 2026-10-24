// 扫码（App 里，或 https 的网页版）：相机画面 + jsQR 逐帧识别。局域网 http 下浏览器不给相机，这时提示用系统相机扫。
import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { CameraOff, ClipboardPaste, ScanLine } from 'lucide-react'
import { Button, Empty, Screen } from '@/ui'
import { L } from '@/i18n'

/** 能不能在页面里开相机（安全上下文 + 有 mediaDevices） */
export const canScan = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && isSecureContext

export function ScanScreen({
  onBack,
  onResult,
  onPaste,
}: {
  onBack(): void
  onResult(text: string): void
  onPaste?: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(
    canScan()
      ? null
      : L(
          '这里打不开相机。可以粘贴电脑上复制的配对链接，或用手机自带的相机 / 微信扫二维码。',
          'The camera can’t be opened here. Paste the pairing link copied on your computer, or scan the QR code with your phone’s camera or WeChat.',
        ),
  )
  const done = useRef(false)

  useEffect(() => {
    if (!canScan()) return
    let stream: MediaStream | null = null
    let frame = 0
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const tick = () => {
      const v = video.current
      if (v && ctx && v.readyState >= 2 && !done.current) {
        // 缩到最长边 720 再识别，手机上更快
        const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight))
        canvas.width = Math.round(v.videoWidth * scale)
        canvas.height = Math.round(v.videoHeight * scale)
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
        if (code?.data) {
          done.current = true
          onResult(code.data)
          return
        }
      }
      frame = requestAnimationFrame(tick)
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(s => {
        stream = s
        if (video.current) {
          video.current.srcObject = s
          void video.current.play()
        }
        frame = requestAnimationFrame(tick)
      })
      .catch(() =>
        setError(
          L(
            '没有相机权限。到系统设置里允许使用相机，或改用粘贴配对链接。',
            'No camera permission. Allow camera access in system settings, or paste the pairing link instead.',
          ),
        ),
      )
    return () => {
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [onResult])

  return (
    <Screen title={L('扫码连接电脑', 'Scan to connect a computer')} onBack={onBack}>
      {error ? (
        <Empty
          icon={CameraOff}
          title={L('打不开相机', 'Can’t open the camera')}
          body={error}
          action={
            onPaste && (
              <Button variant="primary" onClick={onPaste} className="mt-2">
                <ClipboardPaste size={18} /> {L('粘贴配对链接', 'Paste pairing link')}
              </Button>
            )
          }
        />
      ) : (
        <div className="flex flex-col items-center gap-5 px-6 py-6">
          <div className="relative aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-subtle">
            <video ref={video} playsInline muted className="size-full object-cover" />
            <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-accent-on/80" />
            <ScanLine
              size={28}
              className="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 text-accent-on/80"
            />
          </div>
          <p className="text-center text-meta text-fg-muted">
            {L(
              '在电脑上打开像素星空 › 设置 › 手机 › 添加手机，把二维码放进框里。二维码就在这台设备的屏幕上时，改用粘贴配对链接。',
              'On your computer, open PixelSky › Settings › Phone › Add a phone, and fit the QR code in the frame. If the QR code is on this device’s screen, paste the pairing link instead.',
            )}
          </p>
        </div>
      )}
    </Screen>
  )
}
