import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { apply as applyLang, useLang } from './i18n'
import { applyTheme } from './features/me/theme'
import { captureInstallPrompt, registerServiceWorker } from './platform/pwa'
import { startViewport } from './platform/viewport'
import './styles/app.css'

applyTheme()
applyLang()
startViewport()
captureInstallPrompt()
registerServiceWorker()
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme())

/** 换了界面语言：整个界面按新语言重挂（i18n/index.ts）。连接、配对在模块里，不受影响 */
function Root() {
  return <App key={useLang()} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
