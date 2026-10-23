import { useEffect, useState, type FormEvent } from 'react'
import { CalendarPlus, Pencil, Trash2, X } from 'lucide-react'
import { api, errorMessage, formatDay, formatTime, type Playlist, type ScheduleEntry, type ScheduleKind } from '../api'

type Draft = {
  title: string
  description: string
  start: string
  end: string
  kind: ScheduleKind
  playlistId: string
}

function toLocalInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function emptyDraft(): Draft {
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  return {
    title: '',
    description: '',
    start: toLocalInput(start),
    end: toLocalInput(new Date(start.getTime() + 60 * 60000)),
    kind: 'live',
    playlistId: '',
  }
}

function fetchScheduleData() {
  return Promise.all([api<ScheduleEntry[]>('/studio/schedule'), api<Playlist[]>('/studio/playlists')])
}

function SchedulePage() {
  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    const [schedule, lists] = await fetchScheduleData()
    setEntries(schedule)
    setPlaylists(lists)
  }

  useEffect(() => {
    fetchScheduleData()
      .then(([schedule, lists]) => {
        setEntries(schedule)
        setPlaylists(lists)
      })
      .catch((caught) => setMessage(errorMessage(caught)))
  }, [])

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function edit(entry: ScheduleEntry) {
    setEditingId(entry.id)
    setDraft({
      title: entry.title,
      description: entry.description,
      start: toLocalInput(new Date(entry.start)),
      end: toLocalInput(new Date(entry.end)),
      kind: entry.kind,
      playlistId: entry.playlistId ?? '',
    })
    setMessage('')
  }

  function reset() {
    setEditingId(null)
    setDraft(emptyDraft())
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const body = {
        ...draft,
        start: new Date(draft.start).toISOString(),
        end: new Date(draft.end).toISOString(),
        playlistId: draft.kind === 'playlist' ? draft.playlistId : null,
      }
      await api(editingId ? `/studio/schedule/${editingId}` : '/studio/schedule', { method: editingId ? 'PUT' : 'POST', body })
      setMessage(editingId ? 'Slot updated.' : 'Slot added to the schedule.')
      reset()
      await load()
    } catch (caught) {
      setMessage(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function remove(entry: ScheduleEntry) {
    if (!window.confirm(`Remove "${entry.title}" from the schedule?`)) return
    try {
      await api(`/studio/schedule/${entry.id}`, { method: 'DELETE' })
      if (editingId === entry.id) reset()
      await load()
    } catch (caught) {
      setMessage(errorMessage(caught))
    }
  }

  const now = new Date().toISOString()
  const visible = showPast ? entries : entries.filter((entry) => entry.end > now)
  const days = visible.reduce<Map<string, ScheduleEntry[]>>((groups, entry) => {
    const day = formatDay(entry.start)
    groups.set(day, [...(groups.get(day) ?? []), entry])
    return groups
  }, new Map())

  return (
    <main className="studio-page">
      <header className="studio-heading">
        <div>
          <div className="eyebrow">GGTV STUDIO <span>/</span> SCHEDULE</div>
          <h1>Program schedule</h1>
        </div>
      </header>

      <div className="split-grid">
        <form className="control-panel" onSubmit={save}>
          <div className="control-panel-heading">
            <h2>{editingId ? 'Edit slot' : 'New slot'}</h2>
            {editingId && <button className="text-link" type="button" onClick={reset}><X size={12} /> CANCEL</button>}
          </div>
          <div className="graphics-form">
            <label className="field-label">Program title
              <input className="text-input" value={draft.title} onChange={(event) => update('title', event.target.value)} maxLength={120} required />
            </label>
            <div className="field-row">
              <label className="field-label">Starts
                <input className="text-input" type="datetime-local" value={draft.start} onChange={(event) => update('start', event.target.value)} required />
              </label>
              <label className="field-label">Ends
                <input className="text-input" type="datetime-local" value={draft.end} onChange={(event) => update('end', event.target.value)} required />
              </label>
            </div>
            <div className="field-label">Source
              <div className="transition-options" role="group" aria-label="Slot source">
                {(['live', 'playlist'] as const).map((kind) => (
                  <button key={kind} type="button" className={draft.kind === kind ? 'transition-option selected' : 'transition-option'} aria-pressed={draft.kind === kind} onClick={() => update('kind', kind)}>
                    {kind === 'live' ? 'LIVE SHOW' : 'PLAYLIST'}
                  </button>
                ))}
              </div>
            </div>
            {draft.kind === 'playlist' && (
              <label className="field-label">Playlist
                <select className="text-input" value={draft.playlistId} onChange={(event) => update('playlistId', event.target.value)} required>
                  <option value="">{playlists.length ? 'Choose a playlist…' : 'Create a playlist first'}</option>
                  {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
                </select>
              </label>
            )}
            <label className="field-label">Description
              <textarea className="text-input text-area" value={draft.description} onChange={(event) => update('description', event.target.value)} maxLength={500} rows={3} />
            </label>
            <button className="button button-primary" type="submit" disabled={busy}>
              <CalendarPlus size={14} /> {editingId ? 'SAVE CHANGES' : 'ADD TO SCHEDULE'}
            </button>
            {message && <p className="studio-message" role="status">{message}</p>}
          </div>
        </form>

        <section className="control-panel">
          <div className="control-panel-heading">
            <h2>Lineup</h2>
            <label className="toggle-label"><input type="checkbox" checked={showPast} onChange={(event) => setShowPast(event.target.checked)} /> SHOW PAST</label>
          </div>
          {days.size === 0 ? (
            <p className="empty-note">No programs scheduled yet.</p>
          ) : (
            [...days].map(([day, dayEntries]) => (
              <div key={day} className="schedule-day">
                <h3>{day}</h3>
                <ol className="rundown">
                  {dayEntries.map((entry) => {
                    const isNow = entry.start <= now && entry.end > now
                    return (
                      <li key={entry.id} className={[isNow ? 'current' : '', entry.id === editingId ? 'editing' : '', 'rundown-row'].join(' ')}>
                        <span className="rundown-time">{formatTime(entry.start)}<br />{formatTime(entry.end)}</span>
                        <span className="rundown-copy">
                          <strong>{entry.title}</strong>
                          <small>{entry.kind === 'live' ? 'LIVE SHOW' : `PLAYLIST · ${entry.playlistName ?? 'missing'}`}</small>
                        </span>
                        {isNow && <span className="pill pill-live">NOW</span>}
                        <button className="dash-icon-button light" type="button" onClick={() => edit(entry)} aria-label={`Edit ${entry.title}`}><Pencil size={13} /></button>
                        <button className="dash-icon-button light danger" type="button" onClick={() => void remove(entry)} aria-label={`Delete ${entry.title}`}><Trash2 size={13} /></button>
                      </li>
                    )
                  })}
                </ol>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  )
}

export default SchedulePage
