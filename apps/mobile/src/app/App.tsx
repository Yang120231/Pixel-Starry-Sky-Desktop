// 组装：页面切换（任务 / 我的 两个标签，会话、新建、配对是二级页面）。打开 #pair=… 的链接时先进配对页。
// 用浏览器历史做返回：手机上的返回手势 / 返回键能回到上一页。
import { useEffect, useRef, useState } from 'react'
import { ListChecks, ScanLine, Smartphone, UserRound } from 'lucide-react'
import { connections, parseOffer, readOffer, type Offer } from '@/connection'
import { useConnections, useDesktop } from '@/data/hooks'
import { groupTasks } from '@/data/tasks'
import { Composer } from '@/features/composer/Composer'
import { MeScreen } from '@/features/me/MeScreen'
import { PairScreen } from '@/features/pairing/PairScreen'
import { ScanScreen, canScan } from '@/features/pairing/ScanScreen'
import { onBackButton } from '@/platform'
import { useReminders } from './reminders'
import { SessionScreen } from '@/features/session/SessionScreen'
import { NewTask } from '@/features/tasks/NewTask'
import { TaskList } from '@/features/tasks/TaskList'
import { Button, Empty, Screen, TabBar } from '@/ui'

type Route =
  | { page: 'home' }
  | { page: 'session'; id: string }
  | { page: 'new' }
  | { page: 'me' }
  | { page: 'pair' }
  | { page: 'scan' }

function initialPair(): { offer: Offer | null; error: string | null } | null {
  try {
    const offer = readOffer(location.href)
    return offer ? { offer, error: null } : null
  } catch {
    return { offer: null, error: '二维码内容不对，请在电脑上重新生成。' }
  }
}

export function App() {
  const [initial] = useState(initialPair)
  const [pair, setPair] = useState(initial)
  const [route, setRoute] = useState<Route>(pair ? { page: 'pair' } : { page: 'home' })
  const { active } = useConnections()
  const { sessions } = useDesktop(active?.deviceId)
  const waiting = groupTasks(sessions).waiting.length

  useEffect(() => {
    // 配对链接只用一次：从地址栏去掉 #pair=…（不留在历史和截图里）
    if (initial) history.replaceState({ page: 'home' }, '', location.pathname)
    const onPop = (e: PopStateEvent) => setRoute((e.state as Route | null) ?? { page: 'home' })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [initial])

  const go = (next: Route) => {
    history.pushState(next, '')
    setRoute(next)
  }
  const back = () => (history.state && history.state.page !== 'home' ? history.back() : home())
  const home = () => {
    history.replaceState({ page: 'home' }, '')
    setRoute({ page: 'home' })
  }
  // 两个标签之间切换不进历史（返回键不在标签之间来回跳）
  const tab = (page: 'home' | 'me') => {
    history.replaceState({ page }, '')
    setRoute({ page })
  }
  // 点通知：切到那台电脑、打开那个任务
  useReminders((deviceId, sessionId) => {
    connections.select(deviceId)
    go({ page: 'session', id: sessionId })
  })
  // 安卓返回键：二级页面返回，一级页面退到后台
  const routeRef = useRef(route)
  routeRef.current = route
  useEffect(
    () =>
      onBackButton(
        () => !['home', 'me'].includes(routeRef.current.page),
        () => history.back(),
      ),
    [],
  )
  const scanned = (text: string) => {
    try {
      setPair({ offer: parseOffer(text), error: null })
    } catch {
      setPair({ offer: null, error: '这不是像素星空的配对二维码。' })
    }
    history.replaceState({ page: 'pair' }, '')
    setRoute({ page: 'pair' })
  }
  const scanButton = canScan() && (
    <Button variant="primary" onClick={() => go({ page: 'scan' })} className="mt-2">
      <ScanLine size={18} /> 扫码连接电脑
    </Button>
  )

  const tabBar = (
    <TabBar
      items={[
        {
          key: 'home',
          label: '任务',
          icon: ListChecks,
          active: route.page === 'home',
          badge: waiting,
          onClick: () => tab('home'),
        },
        { key: 'me', label: '我的', icon: UserRound, active: route.page === 'me', onClick: () => tab('me') },
      ]}
    />
  )

  if (route.page === 'pair') return <PairScreen offer={pair?.offer ?? null} error={pair?.error ?? null} onDone={home} />
  if (route.page === 'scan') return <ScanScreen onBack={back} onResult={scanned} />
  if (route.page === 'me')
    return <MeScreen tabBar={tabBar} onAdd={canScan() ? () => go({ page: 'scan' }) : undefined} />
  if (!active)
    return (
      <Screen large title="像素星空" footer={tabBar}>
        <Empty
          icon={Smartphone}
          title="还没有连接电脑"
          body="在电脑上打开像素星空 › 设置 › 手机 › 添加手机，用手机相机或微信扫屏幕上的二维码。"
          action={scanButton}
        />
      </Screen>
    )
  if (route.page === 'new')
    return (
      <NewTask
        pairing={active}
        onBack={back}
        onCreated={id => {
          history.replaceState({ page: 'session', id }, '')
          setRoute({ page: 'session', id })
        }}
      />
    )
  if (route.page === 'session')
    return <Session key={route.id} deviceId={active.deviceId} sessionId={route.id} onBack={back} />
  return (
    <TaskList
      pairing={active}
      tabBar={tabBar}
      onOpen={id => go({ page: 'session', id })}
      onNew={() => go({ page: 'new' })}
    />
  )
}

/** 会话页 + 输入框（两个功能在这里拼起来） */
function Session({ deviceId, sessionId, onBack }: { deviceId: string; sessionId: string; onBack(): void }) {
  const pairing = connections.list().find(p => p.deviceId === deviceId)!
  const { link, state, sessions } = useDesktop(deviceId)
  const canAct = state === 'ready' && link?.hello?.access === 'act'
  const s = sessions.find(x => x.record.id === sessionId)
  const running = s?.state === 'running' || s?.state === 'starting'
  return (
    <SessionScreen
      pairing={pairing}
      sessionId={sessionId}
      onBack={onBack}
      composer={<Composer link={link} sessionId={sessionId} canAct={canAct} running={running} />}
    />
  )
}
