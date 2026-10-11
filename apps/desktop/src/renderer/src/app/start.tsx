// 界面的根渲染；由 main.tsx 在装入演示数据（如果是演示模式）之后动态加载
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/globals.css'
import { App } from './App'
import { ThemeProvider } from '../features/appearance/ThemeProvider'
import { SettingsProvider } from '../features/settings/SettingsProvider'
import { ComingSoonProvider } from '../ui'
// 字体、强调色和配色设置在第一次渲染前就写到 <html> 上，避免启动时先闪一下默认字体
import '../features/appearance/fonts'
import '../features/appearance/accent'
import '../features/appearance/palette'
import { WallpaperLayer } from '../features/appearance/WallpaperLayer'
import { SearchProvider } from '../features/search/SearchProvider'
import { I18nProvider } from '../i18n/I18nProvider'
import { SessionActionsProvider } from '../features/sidebar/SessionActions'
import { TerminalProvider } from '../features/terminal/TerminalProvider'
import { CommandPaletteProvider } from '../features/commands/CommandPaletteProvider'
import { installRendererErrorLog, reactRootErrorOptions } from '../features/logs/rendererErrors'
import { installLongTaskLog } from '../features/logs/longTasks'
import { SettingsSyncRunner } from '../features/settings/sync/RestoreNotice'
import { startWindowActivity } from '../features/layout/windowActivity'

document.documentElement.dataset.platform = window.pixelsky?.platform ?? 'web'
// 页面报错、未处理的 Promise 拒绝写进本机日志（docs/ui/logging.md §4.5）
installRendererErrorLog()
// 界面一次卡住超过 2 秒记一条（docs/ui/logging.md §4.9）
installLongTaskLog()
// 窗口不在前台时暂停循环动画（docs/ui/performance.md）
startWindowActivity()

createRoot(document.getElementById('root')!, reactRootErrorOptions).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <WallpaperLayer />
        <SettingsSyncRunner />
        <ComingSoonProvider>
          <SettingsProvider>
            <SearchProvider>
              <SessionActionsProvider>
                <TerminalProvider>
                  <CommandPaletteProvider>
                    <App />
                  </CommandPaletteProvider>
                </TerminalProvider>
              </SessionActionsProvider>
            </SearchProvider>
          </SettingsProvider>
        </ComingSoonProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
)
