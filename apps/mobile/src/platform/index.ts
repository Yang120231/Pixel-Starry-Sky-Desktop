// 平台能力（docs/mobile-remote.md §15）：只有这里接触 Capacitor。浏览器里（网页版）这些都是空操作，
// App 里（安卓）才有：本机通知、后台保持连接（前台服务）、返回键、回到前台。
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { LocalNotifications } from '@capacitor/local-notifications'
import { ForegroundService, type ServiceType } from '@capawesome-team/capacitor-android-foreground-service'

/** 在安卓 App 里（不是浏览器） */
export const inApp = Capacitor.isNativePlatform()

const CHANNEL = 'tasks'
const KEEP_ALIVE_ID = 1
let nextId = 100

/** 第一次用到通知时：建通知渠道、要通知权限（安卓 13 起要用户同意） */
let ready: Promise<boolean> | null = null
function prepare(): Promise<boolean> {
  if (!inApp) return Promise.resolve(false)
  return (ready ??= (async () => {
    try {
      await LocalNotifications.createChannel({
        id: CHANNEL,
        name: '任务提醒',
        description: '任务等你处理、完成或出错时提醒',
        importance: 4,
        visibility: 0,
      })
      const p = await LocalNotifications.checkPermissions()
      if (p.display === 'granted') return true
      return (await LocalNotifications.requestPermissions()).display === 'granted'
    } catch {
      return false
    }
  })())
}

/** 打开 App 时先要通知权限（配过电脑才要），免得切到后台那一刻才弹系统询问 */
export function prepareNotifications(): void {
  void prepare()
}

/** 弹一条本机通知；点了会带着 extra 回来（onNotificationTap） */
export async function notify(title: string, body: string, extra: Record<string, string>): Promise<void> {
  if (!(await prepare())) return
  await LocalNotifications.schedule({
    notifications: [{ id: nextId++, title, body, channelId: CHANNEL, smallIcon: 'ic_stat_pixelsky', extra }],
  }).catch(() => undefined)
}

export function onNotificationTap(handler: (extra: Record<string, string>) => void): () => void {
  if (!inApp) return () => {}
  const sub = LocalNotifications.addListener('localNotificationActionPerformed', e =>
    handler((e.notification.extra ?? {}) as Record<string, string>),
  )
  return () => void sub.then(s => s.remove())
}

/**
 * 后台保持连接：App 切到后台时启动前台服务（通知栏常驻「正在连接电脑」），系统就不会冻结 App，
 * 中转的连接和本机通知照常；回到前台时停掉。被系统或用户杀掉后就收不到了（M4c 的厂商推送补这一块）。
 */
let keeping = false
export async function keepAlive(on: boolean, count = 1): Promise<void> {
  if (!inApp || on === keeping) return
  keeping = on
  try {
    if (on) {
      await prepare()
      await ForegroundService.startForegroundService({
        id: KEEP_ALIVE_ID,
        title: '像素星空',
        body: count > 1 ? `正在连接 ${count} 台电脑，有任务要处理时会提醒你` : '正在连接电脑，有任务要处理时会提醒你',
        smallIcon: 'ic_stat_pixelsky',
        silent: true,
        // 安卓的 FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING（插件的类型里只列了定位和麦克风），和清单里声明的一致
        serviceType: 512 as ServiceType,
      })
    } else await ForegroundService.stopForegroundService()
  } catch {
    keeping = false
  }
}

/** App 切到后台 / 回到前台 */
export function onAppState(handler: (active: boolean) => void): () => void {
  if (!inApp) return () => {}
  const sub = CapApp.addListener('appStateChange', s => handler(s.isActive))
  return () => void sub.then(s => s.remove())
}

/** 安卓返回键：能返回就返回，到了首页就退到后台（不退出，保持连接） */
export function onBackButton(canGoBack: () => boolean, goBack: () => void): () => void {
  if (!inApp) return () => {}
  const sub = CapApp.addListener('backButton', () => (canGoBack() ? goBack() : void CapApp.minimizeApp()))
  return () => void sub.then(s => s.remove())
}
