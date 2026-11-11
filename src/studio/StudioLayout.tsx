import { NavLink, Outlet } from 'react-router-dom'
import { CalendarClock, ExternalLink, LayoutDashboard, ListVideo, LogOut, Mic, MonitorPlay, RadioTower, Users, Volume2 } from 'lucide-react'
import { useAuth } from '../auth'
import { useSwitcher } from './switcherContext'

const links = [
  { to: '/studio', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/studio/live', label: 'Go live', icon: RadioTower },
  { to: '/studio/preview', label: 'Preview', icon: MonitorPlay },
  { to: '/studio/schedule', label: 'Schedule', icon: CalendarClock },
  { to: '/studio/playlists', label: 'Playlists', icon: ListVideo },
  { to: '/studio/guests', label: 'Guests', icon: Users },
]

function StudioLayout() {
  const { user, logout } = useAuth()
  const { output, live, guests } = useSwitcher()
  const badges: Record<string, string | null> = {
    '/studio/live': live?.isLive ? 'ON AIR' : output.state === 'streaming' ? 'SENDING' : null,
    '/studio/guests': guests.length ? `${guests.length} IN` : null,
  }

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar">
        <div className="brand dash-brand">
          <img className="brand-logo" src="/logo.png" alt="GGTV" />
          <span className="dash-brand-sub">STUDIO</span>
        </div>

        <nav className="dash-nav" aria-label="Studio navigation">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'dash-link active' : 'dash-link'}>
              <Icon size={16} /> <span>{label}</span>
              {badges[to] && <small className={badges[to] === 'ON AIR' ? 'nav-badge live' : 'nav-badge'}>{badges[to]}</small>}
            </NavLink>
          ))}
        </nav>

        <div className="dash-sidebar-footer">
          <a className="dash-link" href="/" target="_blank" rel="noreferrer"><ExternalLink size={15} /> <span>View channel</span></a>
          <div className="dash-user">
            <span className="dash-avatar">{user?.slice(0, 1).toUpperCase()}</span>
            <span className="dash-user-name">{user}</span>
            <button className="dash-icon-button" type="button" onClick={() => void logout()} aria-label="Sign out" title="Sign out"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      <div className="dash-main">
        {guests.length > 0 && output.audioBlocked && (
          <div className="studio-sound-alert" role="alert">
            <Volume2 size={15} />
            <span>Sound is paused by the browser, so you can't hear guests and they can't hear you.</span>
            <button className="button button-primary" type="button" onClick={output.unlockAudio}>TURN SOUND ON</button>
          </div>
        )}
        {guests.length > 0 && !output.audioBlocked && !output.micOn && (
          <div className="studio-sound-alert" role="status">
            <Mic size={15} />
            <span>Your mic is off, so guests can't hear you.</span>
            <button className="button button-primary" type="button" onClick={() => void output.turnMicOn()}>TURN MIC ON</button>
          </div>
        )}
        <Outlet />
      </div>
    </div>
  )
}

export default StudioLayout
