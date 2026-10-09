import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import { App } from './App'
import { ThemeProvider } from './theme/ThemeProvider'
import { SettingsProvider } from './settings/SettingsProvider'
import { ComingSoonProvider } from './components/ui'
// 字体设置在第一次渲染前就写到 <html> 上，避免启动时先闪一下默认字体
import './appearance/fonts'
import { WallpaperLayer } from './appearance/WallpaperLayer'
import { SearchProvider } from './search/SearchProvider'
import { I18nProvider } from './i18n/I18nProvider'
import { SessionActionsProvider } from './components/sidebar/SessionActions'
import { TerminalProvider } from './terminal/TerminalProvider'
import { CommandPaletteProvider } from './commands/CommandPaletteProvider'

document.documentElement.dataset.platform = window.pixelsky?.platform ?? 'web'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <WallpaperLayer />
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
