// 「添加到主屏幕」要按浏览器给不同的步骤（docs/mobile-remote.md §20）。只看 userAgent，纯函数，不碰 window。
export type InstallEnv = 'ios-safari' | 'ios-other' | 'wechat' | 'android-chrome' | 'android-other' | 'desktop'

// 微信、QQ 的内置浏览器：自己的菜单里没有「添加到主屏幕」，要先在系统浏览器里打开
const IN_APP = /MicroMessenger|WeChat|\bQQ\/|MQQBrowser/i
// iOS 上不是 Safari 的浏览器（带 Safari 字样但各有各的外壳）
const IOS_OTHER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|Quark|UCBrowser|baidubrowser|MiuiBrowser/i
// 安卓上不是 Chrome 的浏览器（UA 里也写着 Chrome/）；「; wv)」是应用内的 WebView
const ANDROID_OTHER =
  /EdgA|OPR\/|SamsungBrowser|UCBrowser|Quark|baidubrowser|HuaweiBrowser|MiuiBrowser|HeyTapBrowser|VivoBrowser|; wv\)/i

/** maxTouchPoints：iPadOS 默认把 UA 伪装成 Mac，靠它（> 1）认出 iPad */
export function detectInstallEnv(ua: string, maxTouchPoints = 0): InstallEnv {
  if (IN_APP.test(ua)) return 'wechat'
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) {
    return /Safari\//.test(ua) && !IOS_OTHER.test(ua) ? 'ios-safari' : 'ios-other'
  }
  if (/Android/.test(ua)) return /Chrome\//.test(ua) && !ANDROID_OTHER.test(ua) ? 'android-chrome' : 'android-other'
  return 'desktop'
}
