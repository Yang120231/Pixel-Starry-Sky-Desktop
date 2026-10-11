// 安卓 App（docs/mobile-remote.md §15，M4a）：打包网页版（vite build --mode app）进 App，不再从服务器取页面代码。
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'xyz.pixelstarrysky.mobile',
  appName: '像素星空',
  webDir: 'dist',
  android: {
    // 只连 https / wss；本机测试中转（http）时另外放开
    allowMixedContent: false,
  },
  plugins: {
    // 页面里的 fetch 走原生 HTTP：App 的页面和云端不同源，浏览器的跨域限制会挡住配对接口
    CapacitorHttp: { enabled: true },
    LocalNotifications: { smallIcon: 'ic_stat_pixelsky' },
  },
}

export default config
