import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { applyTheme } from './features/me/theme'
import './styles/app.css'

applyTheme()
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
