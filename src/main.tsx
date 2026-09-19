import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import App from '@/App.tsx'
import '@/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* HashRouter — надёжная SPA-навигация при хостинге на GitHub Pages. */}
    <HashRouter>
      <Routes>
        <Route path="*" element={<App />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)
