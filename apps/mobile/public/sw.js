// 网页版的 service worker（docs/mobile-remote.md §20）：只做一件事——打开页面时没有网络，显示「没有网络」页，而不是浏览器自带的错误页。
// 故意不缓存 JS / CSS / 接口，也不碰 /v1/bridge 和 WebSocket：每次发版后页面都直接取最新的，不会读到旧版本。
const CACHE = 'pixelsky-offline-v1'
const OFFLINE = './offline.html' // 相对 sw.js，线上就是 /m/offline.html

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE)))
  // 这个 worker 没有任何要保留的状态，新版装好直接接手，不用等旧页面都关掉
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // 改了离线页就把 CACHE 加一个版本号，旧的在这里清掉
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      // 第一次装好后，已经打开的页面也归它管（否则要刷新一次才生效）
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', event => {
  // 只管「打开页面」：先走网络，网络不通（fetch 抛错）才回退到离线页。服务器返回的 4xx / 5xx 原样给浏览器
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE)) ?? Response.error()))
})
