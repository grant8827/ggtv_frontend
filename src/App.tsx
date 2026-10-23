import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Radio } from 'lucide-react'
import './App.css'
import './GGTV.css'
import './Dashboard.css'
import AuthProvider from './AuthProvider'
import { useAuth } from './auth'
import WatchPage from './WatchPage'
import StudioPage from './StudioPage'
import LoginPage from './studio/LoginPage'
import StudioLayout from './studio/StudioLayout'
import OverviewPage from './studio/OverviewPage'
import GoLivePage from './studio/GoLivePage'
import SchedulePage from './studio/SchedulePage'
import PlaylistsPage from './studio/PlaylistsPage'

function ViewerLayout() {
  const [clock, setClock] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="GGTV home">
          <span className="brand-mark"><Radio size={18} strokeWidth={2.5} /></span>
          <span>GG<span className="brand-accent">TV</span></span>
        </Link>

        <div className="topbar-status">
          <span className="status-light" />
          <span>BROADCAST NETWORK</span>
          <time>{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        </div>
      </header>

      <Outlet />
    </div>
  )
}

function RequireStudioLogin() {
  const { user, checking } = useAuth()
  const location = useLocation()

  if (checking) return <div className="dash-loading">Checking studio session…</div>
  if (!user) return <Navigate to="/studio/login" replace state={{ from: location.pathname }} />
  return <StudioLayout />
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/studio/login" element={<LoginPage />} />
        <Route path="/studio" element={<RequireStudioLogin />}>
          <Route index element={<OverviewPage />} />
          <Route path="live" element={<GoLivePage />} />
          <Route path="switcher" element={<StudioPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="playlists" element={<PlaylistsPage />} />
          <Route path="*" element={<Navigate to="/studio" replace />} />
        </Route>
        <Route element={<ViewerLayout />}>
          <Route path="/" element={<WatchPage />} />
          <Route path="*" element={<WatchPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}

export default App
