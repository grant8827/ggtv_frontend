import { NavLink, Outlet } from 'react-router-dom'
import { CalendarClock, Clapperboard, ExternalLink, LayoutDashboard, ListVideo, LogOut, Radio, RadioTower } from 'lucide-react'
import { useAuth } from '../auth'
import { useSwitcher } from './switcherContext'

const links = [
  { to: '/studio', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/studio/live', label: 'Go live', icon: RadioTower },
  { to: '/studio/switcher', label: 'Switcher', icon: Clapperboard },
  { to: '/studio/schedule', label: 'Schedule', icon: CalendarClock },
  { to: '/studio/playlists', label: 'Playlists', icon: ListVideo },
]

function StudioLayout() {
  const { user, logout } = useAuth()
  const { output, live } = useSwitcher()
  const badges: Record<string, string | null> = {
    '/studio/live': live?.isLive ? 'ON AIR' : null,
    '/studio/switcher': output.state === 'streaming' ? 'SENDING' : null,
  }

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar">
        <div className="brand dash-brand">
          <span className="brand-mark"><Radio size={18} strokeWidth={2.5} /></span>
          <span>GG<span className="brand-accent">TV</span> <span className="dash-brand-sub">STUDIO</span></span>
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
        <Outlet />
      </div>
    </div>
  )
}

export default StudioLayout
