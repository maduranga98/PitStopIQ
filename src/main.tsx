import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'

// The entry bundle loaded and executed, so clear the one-shot recovery guard in
// index.html. This lets a later stale-deploy failure trigger a fresh recovery
// reload instead of being suppressed for the rest of the session.
window.sessionStorage.removeItem('pitstopiq:entry-reload')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
