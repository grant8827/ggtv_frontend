import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, CircleDot, Radio, Signal, Tv } from 'lucide-react'
import HlsPlayer from './HlsPlayer'
import { api, formatDay, formatTime, type LiveStatus, type ScheduleEntry } from './api'

const localStream = import.meta.env.VITE_GGTV_HLS_URL ?? 'http://localhost:8080/live/demo.m3u8'

const channels = [
  { id: '01', name: 'GGTV Live', detail: 'MAIN FEED', stream: localStream },
]

function WatchPage() {
  const [selectedId, setSelectedId] = useState(channels[0].id)
  const [overrideUrl, setOverrideUrl] = useState<string | null>(null)
  const [draftUrl, setDraftUrl] = useState<string | null>(null)
  const [live, setLive] = useState<LiveStatus | null>(null)
  const [offline, setOffline] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleEntry[] | null>(null)
  const selectedChannel = channels.find((channel) => channel.id === selectedId) ?? channels[0]
  const isMainChannel = selectedChannel.id === channels[0].id
  // The main feed's HLS address comes from the backend (HLS_BASE_URL) once it responds.
  const channelStream = isMainChannel ? live?.hlsUrl ?? selectedChannel.stream : selectedChannel.stream
  const streamUrl = overrideUrl ?? channelStream

  useEffect(() => {
    function refresh() {
      api<LiveStatus>('/live')
        .then((status) => { setLive(status); setOffline(false) })
        .catch(() => { setLive(null); setOffline(true) })
      api<ScheduleEntry[]>('/schedule').then(setSchedule).catch(() => setSchedule(null))
    }
    refresh()
    const timer = window.setInterval(refresh, 15000)
    return () => window.clearInterval(timer)
  }, [])

  const now = new Date().toISOString()
  const onNow = schedule?.find((entry) => entry.start <= now && entry.end > now)
  const mainSource = isMainChannel ? live?.source : undefined
  // The main feed shows the same screens as the apps when there's nothing to play. A URL typed
  // into the source settings is always played.
  const slate = !isMainChannel || overrideUrl
    ? undefined
    : !live
      ? offline ? { title: 'NO CONNECTION', detail: 'Check your internet connection.' } : { title: 'TUNING IN', detail: '' }
      : live.source === 'off' ? { title: 'OFF AIR', detail: 'GGTV will be back soon.' } : undefined
  const heading = mainSource === 'live'
    ? live!.title
    : mainSource === 'playlist' ? live!.nowPlaying?.slotTitle ?? selectedChannel.name : selectedChannel.name
  const subheading = mainSource === 'live'
    ? live!.description || 'Live feed from the GGTV origin'
    : mainSource === 'playlist'
      ? `Now playing: ${live!.nowPlaying?.itemTitle ?? 'scheduled programming'}`
      : isMainChannel && onNow ? `On the schedule: ${onNow.title}` : 'Live feed from the GGTV origin'

  function selectChannel(channel: (typeof channels)[number]) {
    setSelectedId(channel.id)
    setOverrideUrl(null)
    setDraftUrl(null)
  }

  function connectStream(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setOverrideUrl((draftUrl ?? streamUrl).trim())
  }

  return (
    <main className="page-wrap">
      <div className="eyebrow"><span className="live-dot" /> GGTV BROADCAST NETWORK <span> / </span> VIEWER</div>
      <div className="page-heading">
        <div>
          <h1>Live television, <span className="heading-accent">in focus.</span></h1>
          <p>A direct line to what’s happening now.</p>
        </div>
      </div>

      <div className="watch-layout">
        <section className="viewer-column" aria-label="Live channel player">
          <HlsPlayer src={slate ? '' : streamUrl} channelName={selectedChannel.name} slate={slate} viewer />
          <div className="player-meta">
            <div>
              <div className="channel-code"><CircleDot size={13} /> CHANNEL {selectedChannel.id} <span>/</span> {selectedChannel.detail}</div>
              <h2>{heading}</h2>
              <p>{subheading}</p>
            </div>
            <span className={mainSource === 'live' ? 'signal-badge on-air' : mainSource === 'playlist' ? 'signal-badge on-schedule' : 'signal-badge'}>
              {mainSource ? { live: 'ON AIR', playlist: 'NOW PLAYING', off: 'OFF AIR' }[mainSource] : streamUrl ? 'AWAITING SIGNAL' : 'OFFLINE'}
            </span>
          </div>

          <details className="stream-setup">
            <summary>HLS SOURCE SETTINGS</summary>
            <form className="stream-form" onSubmit={connectStream}>
              <input
                className="text-input"
                aria-label="HLS stream URL"
                type="url"
                placeholder="https://origin.example/live/channel.m3u8"
                value={draftUrl ?? streamUrl}
                onChange={(event) => setDraftUrl(event.target.value)}
              />
              <button className="button button-dark" type="submit">CONNECT</button>
            </form>
          </details>
        </section>

        <aside>
          <section className="channel-panel">
            <div className="panel-heading"><h2>Channel lineup</h2><span>{String(channels.length).padStart(2, '0')} FEED{channels.length === 1 ? '' : 'S'}</span></div>
            <div className="channel-list">
              {channels.map((channel) => (
                <button
                  className={selectedId === channel.id ? 'channel-row selected' : 'channel-row'}
                  key={channel.id}
                  type="button"
                  onClick={() => selectChannel(channel)}
                  aria-pressed={selectedId === channel.id}
                >
                  <span className="channel-number">{channel.id}</span>
                  <span className="channel-copy"><strong>{channel.name}</strong><small>{channel.detail}</small></span>
                  {channel.stream ? <Signal className="channel-arrow" size={15} /> : <ArrowRight className="channel-arrow" size={14} />}
                </button>
              ))}
            </div>
          </section>

          <section className="channel-panel schedule-panel">
            <div className="panel-heading"><h2>On the schedule</h2><span>EPG</span></div>
            {schedule && schedule.length > 0 ? (
              <ol className="epg-list">
                {schedule.slice(0, 6).map((entry) => (
                  <li key={entry.id} className={entry === onNow ? 'epg-row current' : 'epg-row'}>
                    <span className="epg-time">{entry === onNow ? 'NOW' : `${formatDay(entry.start)} · ${formatTime(entry.start)}`}</span>
                    <strong>{entry.title}</strong>
                    {entry.description && <small>{entry.description}</small>}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="schedule-empty">
                <Tv size={18} />
                <p>{schedule ? 'No programs are scheduled right now. Check back soon.' : 'Program listings will appear when the GGTV schedule service is connected.'}</p>
              </div>
            )}
          </section>

          <div className="viewer-note"><Radio size={14} /><span>{live ? { live: `On air since ${formatTime(live.startedAt!)}.`, playlist: 'Scheduled programming is playing.', off: 'The channel is currently off air.' }[live.source] : 'Playback uses HLS. The live origin is not connected yet.'}</span></div>
        </aside>
      </div>
    </main>
  )
}

export default WatchPage