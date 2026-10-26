import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock, ListVideo, Plug, RadioTower } from 'lucide-react'
import { api, describeEntry, errorMessage, formatDay, formatTime, type Playlist, type ScheduleEntry, type StudioLive } from '../api'

function OverviewPage() {
  const [live, setLive] = useState<StudioLive | null>(null)
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api<StudioLive>('/studio/live'),
      api<ScheduleEntry[]>('/studio/schedule'),
      api<Playlist[]>('/studio/playlists'),
    ])
      .then(([liveState, entries, lists]) => {
        setLive(liveState)
        setSchedule(entries)
        setPlaylists(lists)
      })
      .catch((caught) => setError(errorMessage(caught)))
  }, [])

  const now = new Date().toISOString()
  const upcoming = schedule.filter((entry) => entry.end > now)
  const onNow = upcoming.find((entry) => entry.start <= now)
  const next = upcoming.find((entry) => entry.start > now)

  return (
    <main className="studio-page">
      <header className="studio-heading">
        <div>
          <div className="eyebrow">GGTV STUDIO <span>/</span> OVERVIEW</div>
          <h1>Control room</h1>
        </div>
        <Link to="/studio/live" className="button button-primary"><RadioTower size={15} /> GO LIVE</Link>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}
      {live?.playout.state === 'error' && (
        <p className="form-error" role="alert">Playlist "{live.playout.playlistName}" can't play: {live.playout.error}</p>
      )}

      <div className="stat-grid">
        <section className={live?.isLive ? 'stat-card on-air' : 'stat-card'}>
          <span className="stat-label"><RadioTower size={13} /> BROADCAST</span>
          <strong>{live ? { live: 'ON AIR', playlist: 'PLAYLIST', off: 'OFF AIR' }[live.source] : '—'}</strong>
          <small>{live?.source === 'live' ? live.title : live?.source === 'playlist' ? `Playing "${live.playout.itemTitle}"` : 'Viewers see the channel as offline'}</small>
        </section>
        <section className="stat-card">
          <span className="stat-label"><Plug size={13} /> ENCODER</span>
          <strong>{live ? (live.encoderConnected ? 'CONNECTED' : 'WAITING') : '—'}</strong>
          <small>{live ? `Stream "${live.streamName}"` : ' '}</small>
        </section>
        <section className="stat-card">
          <span className="stat-label"><CalendarClock size={13} /> {onNow ? 'ON NOW' : 'NEXT UP'}</span>
          <strong>{onNow?.title ?? next?.title ?? 'Nothing scheduled'}</strong>
          <small>{(onNow ?? next) ? `${formatDay((onNow ?? next)!.start)} · ${formatTime((onNow ?? next)!.start)}` : 'Add slots on the schedule'}</small>
        </section>
        <section className="stat-card">
          <span className="stat-label"><ListVideo size={13} /> PLAYLISTS</span>
          <strong>{playlists.length}</strong>
          <small>{playlists.reduce((total, playlist) => total + playlist.items.length, 0)} items in the library</small>
        </section>
      </div>

      <section className="control-panel dash-section">
        <div className="control-panel-heading">
          <h2>Upcoming rundown</h2>
          <Link to="/studio/schedule" className="text-link">EDIT SCHEDULE <ArrowRight size={12} /></Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="empty-note">No upcoming programs. Build your lineup on the Schedule page.</p>
        ) : (
          <ol className="rundown">
            {upcoming.slice(0, 8).map((entry) => (
              <li key={entry.id} className={entry === onNow ? 'rundown-row current' : 'rundown-row'}>
                <span className="rundown-time">{formatDay(entry.start)}<br />{formatTime(entry.start)}–{formatTime(entry.end)}</span>
                <span className="rundown-copy"><strong>{entry.title}</strong><small>{describeEntry(entry)}</small></span>
                {entry === onNow && <span className="pill pill-live">NOW</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  )
}

export default OverviewPage
