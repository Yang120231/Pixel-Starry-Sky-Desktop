// 生成应用标志的全部图片（docs/brand/logo-replacement.md）：桌面应用图标（Windows .ico、macOS、Linux）、
// 手机网页版的网页图标和主屏幕图标。每个尺寸都从矢量图形直接画，不缩放位图。
// 用法：pnpm --filter @pixelsky/desktop exec electron scripts/make-brand-icons.mjs（环境里不能有 ELECTRON_RUN_AS_NODE，空值也不行）；
// 画完再跑 scripts/make-tray-icons.mjs 更新托盘图标。界面里的同一个标在 src/renderer/src/ui/Logo.tsx，改图形时一起改。
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ico } from './ico.mjs'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
const mobile = join(desktop, '../mobile/public')

// 方块标：深色圆角方块（边长 70、圆角 16.5）里一个单线 P（粗 5、碗高 23），右上一颗浅橙四角星。
// 坐标是线条中线：P 的竖画在 x=0、高 0–40；整个标的中心在 (19, 20)，P 和星离中心最远约 30
const TILE = '#1d1915'
const GLYPH =
  '<path fill="none" stroke="#f4efe8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" d="M0 40V0H11A11.5 11.5 0 0 1 11 23H0"/>' +
  '<path fill="#f0a764" stroke="#f0a764" stroke-width="1.5" stroke-linejoin="round" d="M34 -1.75Q35.4 3.85 41 5.25Q35.4 6.65 34 12.25Q32.6 6.65 27 5.25Q32.6 3.85 34 -1.75Z"/>'
const CX = 19
const CY = 20

/** 以标的中心为心、边长 side 的正方形画布；back 是垫在 P 和星下面的底 */
const mark = (side, back) => px => {
  const x = CX - side / 2
  const y = CY - side / 2
  const base =
    back === 'tile'
      ? `<rect x="${CX - 35}" y="${CY - 35}" width="70" height="70" rx="16.5" fill="${TILE}"/>`
      : back === 'fill'
        ? `<rect x="${x}" y="${y}" width="${side}" height="${side}" fill="${TILE}"/>`
        : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${x} ${y} ${side} ${side}">${base}${GLYPH}</svg>`
}
const ART = {
  /** 应用图标本体：方块铺满画布，四角透明 */
  badge: mark(70, 'tile'),
  /** macOS：1024 画布里方块占 824，四周留白，和系统里别的图标一样大 */
  mac: mark((70 * 1024) / 824, 'tile'),
  /** iOS 主屏幕：不透明的整方块，系统自己切圆角 */
  touch: mark(70, 'fill'),
  /** 可遮罩图标：P 和星缩到中间 80% 的安全圆里（安全圆半径 0.4 × 82 ≈ 33 > 30） */
  maskable: mark(70 / 0.85, 'fill'),
}

const icon = (art, px) => ({ w: px, h: px, bg: null, svg: ART[art](px), iw: px, ih: px })

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
/** [输出文件, 画法] */
const jobs = [
  [join(desktop, 'build/icon.png'), icon('badge', 1024)],
  [join(desktop, 'build/icon-mac.png'), icon('mac', 1024)],
  [join(mobile, 'favicon.png'), icon('badge', 32)],
  [join(mobile, 'icons/icon-192.png'), icon('badge', 192)],
  [join(mobile, 'icons/icon-512.png'), icon('badge', 512)],
  [join(mobile, 'icons/icon-maskable-512.png'), icon('maskable', 512)],
  [join(mobile, 'apple-touch-icon.png'), icon('touch', 180)],
]

/** 在页面里用 canvas 画：先铺底色，再把 SVG 按目标尺寸画在正中 */
async function render(win, list) {
  const out = await win.webContents.executeJavaScript(`(async jobs => {
    const out = []
    for (const j of jobs) {
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(j.svg)
      await img.decode()
      const c = Object.assign(document.createElement('canvas'), { width: j.w, height: j.h })
      const g = c.getContext('2d')
      if (j.bg) { g.fillStyle = j.bg; g.fillRect(0, 0, j.w, j.h) }
      g.drawImage(img, Math.round((j.w - j.iw) / 2), Math.round((j.h - j.ih) / 2), j.iw, j.ih)
      out.push(c.toDataURL('image/png').split(',')[1])
    }
    return out
  })(${JSON.stringify(list)})`)
  return out.map(b => Buffer.from(b, 'base64'))
}

app.disableHardwareAcceleration()
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await win.loadURL('about:blank')
    const pngs = await render(
      win,
      jobs.map(([, j]) => j),
    )
    jobs.forEach(([file], k) => {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, pngs[k])
    })
    const frames = await render(
      win,
      ICO_SIZES.map(px => icon('badge', px)),
    )
    writeFileSync(join(desktop, 'build/icon.ico'), ico(ICO_SIZES.map((size, k) => ({ size, png: frames[k] }))))
    // 方块标的矢量原图，给设计稿和别处引用
    writeFileSync(join(desktop, 'build/brand/badge.svg'), ART.badge(512) + '\n')
    console.log(`写好了 ${jobs.length + 2} 个文件`)
    win.destroy()
    app.quit()
  })
  .catch(err => {
    console.error(err)
    app.exit(1)
  })
