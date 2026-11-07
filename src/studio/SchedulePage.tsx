import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, CalendarPlus, Link2, Pencil, Plus, Radio, Repeat, Server, Trash2, Upload, X } from 'lucide-react'
import {
  api, describeEntry, errorMessage, everyLabel, formatDay, formatTime, repeatSummary, uploadMedia, WEEKDAYS,
  type BreakRepeat, type MediaLibrary, type Playlist, type PlaylistItem, type RepeatFrequency, type ScheduleEntry, type ScheduleKind, type StudioLive,
} from '../api'
import { videoMinutes } from './mediaStore'

type Draft = {
  title: string
  description: string
  start: string
  end: string
  kind: ScheduleKind
  playlistId: string
  // A playlist slot plays a saved playlist, or its own list of video links and uploads.
  playlistSource: 'playlist' | 'videos'
  items: PlaylistItem[]
  repeat: RepeatDraft
}

// How often a break plays, as edited in the form.
type RepeatDraft = {
  frequency: RepeatFrequency
  weekdays: number[]
  everyMinutes: number
  untilTime: string
  endDate: string // '' = no end
}

const FREQUENCY_LABELS: Record<RepeatFrequency, string> = { once: 'ONCE', daily: 'EVERY DAY', weekly: 'EVERY WEEK', monthly: 'EVERY MONTH' }
const EVERY_CHOICES = [0, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240]

function emptyRepeat(start: string): RepeatDraft {
  return { frequency: 'once', weekdays: [new Date(start).getDay()], everyMinutes: 0, untilTime: '17:00', endDate: '' }
}

function repeatBody(draft: RepeatDraft): BreakRepeat | null {
  if (draft.frequency === 'once') return null
  return {
    frequency: draft.frequency,
    weekdays: draft.frequency === 'weekly' ? draft.weekdays : [],
    everyMinutes: draft.everyMinutes,
    untilTime: draft.everyMinutes ? draft.untilTime : null,
    endDate: draft.endDate || null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

// A date and a time picked separately (stored together as 'YYYY-MM-DDTHH:MM' local time).
function DateTimeFields({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [date = '', time = ''] = value.split('T')
  return (
    <div className="field-label">{label}
      <div className="date-time-fields">
        <input className="text-input" type="date" aria-label={`${label} date`} value={date} onChange={(event) => onChange(`${event.target.value}T${time || '00:00'}`)} required />
        <input className="text-input" type="time" aria-label={`${label} time`} value={time} onChange={(event) => onChange(`${date}T${event.target.value}`)} required />
      </div>
    </div>
  )
}

// How often a break plays: once, or every day / week / month, and optionally again and again
// during each of those days.
function RepeatFields({ repeat, start, onChange }: { repeat: RepeatDraft; start: string; onChange: (repeat: RepeatDraft) => void }) {
  const set = (patch: Partial<RepeatDraft>) => onChange({ ...repeat, ...patch })
  const startTime = start.split('T')[1] ?? ''
  const toggleDay = (day: number) => {
    const days = repeat.weekdays.includes(day) ? repeat.weekdays.filter((item) => item !== day) : [...repeat.weekdays, day].sort()
    set({ weekdays: days })
  }
  const custom = !EVERY_CHOICES.includes(repeat.everyMinutes)
  const body = repeatBody(repeat)
  const startIso = start ? new Date(start).toISOString() : ''

  return (
    <fieldset className="repeat-fields">
      <legend><Repeat size={13} /> Repeat</legend>
      <div className="field-label">How often
        <div className="transition-options" role="group" aria-label="How often the break plays">
          {(['once', 'daily', 'weekly', 'monthly'] as const).map((frequency) => (
            <button key={frequency} type="button" className={repeat.frequency === frequency ? 'transition-option selected' : 'transition-option'} aria-pressed={repeat.frequency === frequency} onClick={() => set(frequency === 'weekly' && repeat.frequency !== 'weekly' && startIso ? { frequency, weekdays: [new Date(startIso).getDay()] } : { frequency })}>
              {FREQUENCY_LABELS[frequency]}
            </button>
          ))}
        </div>
      </div>

      {repeat.frequency === 'weekly' && (
        <div className="field-label">On these days
          <div className="weekday-picker" role="group" aria-label="Days of the week">
            {WEEKDAYS.map((name, day) => (
              <button key={name} type="button" className={repeat.weekdays.includes(day) ? 'weekday selected' : 'weekday'} aria-pressed={repeat.weekdays.includes(day)} onClick={() => toggleDay(day)}>{name}</button>
            ))}
          </div>
        </div>
      )}

      {repeat.frequency === 'weekly' && startIso && repeat.weekdays.length > 0 && !repeat.weekdays.includes(new Date(startIso).getDay()) && (
        <p className="form-error">The first break date is a {WEEKDAYS[new Date(startIso).getDay()]}, which isn't selected, so it starts on the next selected day.</p>
      )}

      {repeat.frequency === 'monthly' && startIso && (
        <p className="empty-note">Plays on day {new Date(startIso).getDate()} of every month (the last day in shorter months).</p>
      )}

      <div className="field-row">
        <label className="field-label">Repeat during the day
          <select className="text-input" value={custom ? 'custom' : repeat.everyMinutes} onChange={(event) => set({ everyMinutes: event.target.value === 'custom' ? 25 : Number(event.target.value) })}>
            {EVERY_CHOICES.map((minutes) => <option key={minutes} value={minutes}>{minutes ? `Every ${everyLabel(minutes)}` : 'No, just once'}</option>)}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {repeat.everyMinutes > 0 && (
          <label className="field-label">Last one at
            <input className="text-input" type="time" value={repeat.untilTime} onChange={(event) => set({ untilTime: event.target.value })} required />
          </label>
        )}
      </div>
      {custom && (
        <label className="field-label minutes-field">Every
          <input className="text-input" type="number" min="5" max="720" step="1" value={repeat.everyMinutes} onChange={(event) => set({ everyMinutes: Math.round(Number(event.target.value)) })} aria-label="Repeat every how many minutes" />
          <span>MIN</span>
        </label>
      )}
      {repeat.everyMinutes > 0 && repeat.untilTime && startTime && repeat.untilTime < startTime && (
        <p className="form-error">The last one is before the start time ({startTime}), so it plays once a day.</p>
      )}

      {repeat.frequency !== 'once' && (
        <div className="field-row">
          <label className="field-label">Ends
            <select className="text-input" value={repeat.endDate ? 'date' : 'never'} onChange={(event) => set({ endDate: event.target.value === 'date' ? (start.split('T')[0] ?? '') : '' })}>
              <option value="never">Never</option>
              <option value="date">On a date</option>
            </select>
          </label>
          {repeat.endDate && (
            <label className="field-label">Last day
              <input className="text-input" type="date" value={repeat.endDate} min={start.split('T')[0]} onChange={(event) => set({ endDate: event.target.value })} required />
            </label>
          )}
        </div>
      )}

      {startIso && <p className="repeat-summary"><strong>PLAYS</strong> {repeatSummary(body, startIso)}</p>}
    </fieldset>
  )
}

const KIND_LABELS: Record<ScheduleKind, string> = { live: 'LIVE SHOW', playlist: 'PLAYLIST', break: 'BREAK' }
const newId = () => `new-${Date.now()}-${Math.random().toString(36).slice(2)}`
const totalMinutes = (items: PlaylistItem[]) => items.reduce((sum, item) => sum + (Number(item.durationMinutes) || 0), 0)

// The server's own channel: what plays when nobody is live from the studio.
function OffAirChannel({ playlists }: { playlists: Playlist[] }) {
  const [fillPlaylistId, setFillPlaylistId] = useState<string | null>(null)
  const [live, setLive] = useState<StudioLive | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    api<{ fillPlaylistId: string }>('/studio/channel').then((channel) => setFillPlaylistId(channel.fillPlaylistId)).catch(() => undefined)
    const refresh = () => api<StudioLive>('/studio/live').then(setLive).catch(() => undefined)
    void refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [])

  async function choose(id: string) {
    setFillPlaylistId(id)
    try {
      await api('/studio/channel', { method: 'PUT', body: { fillPlaylistId: id } })
      setNote(id ? 'Saved. The server plays this whenever nobody is live from the studio.' : 'Saved. The channel is off air when nobody is live and nothing is scheduled.')
    } catch (caught) {
      setNote(errorMessage(caught))
    }
  }

  const playout = live?.playout
  const now = live?.isLive ? 'The studio is live, so the server channel is paused.'
    : playout?.state === 'playing' || playout?.state === 'starting'
      ? `${playout.kind === 'break' ? 'Break' : playout.kind === 'slot' ? 'Scheduled' : 'Fill'}: "${playout.slotTitle}"${playout.itemTitle ? ` · ${playout.itemTitle}` : ''}`
      : playout?.state === 'error' ? `Can't play: ${playout.error}` : 'Nothing playing (off air).'

  return (
    <section className="control-panel dash-section off-air-panel">
      <div className="control-panel-heading"><h2><Radio size={14} /> Off-air channel</h2><span>RUNS ON THE SERVER · NO STUDIO NEEDED</span></div>
      <div className="off-air-grid">
        <label className="field-label">Fill playlist when nobody is live
          <select className="text-input" value={fillPlaylistId ?? ''} onChange={(event) => void choose(event.target.value)} disabled={fillPlaylistId === null}>
            <option value="">None (off air between shows)</option>
            {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
          </select>
        </label>
        <p className={`automation-status mode-${live?.isLive ? 'live' : playout?.kind === 'break' ? 'break' : playout?.kind === 'slot' ? 'playlist' : playout?.state === 'playing' ? 'fill' : 'off'}`}>
          <strong>NOW</strong> {now}
        </p>
      </div>
      <p className="empty-note">
        With the studio closed, the server plays breaks and playlist slots on time and this fill playlist in between (resuming where it paused).
        Live shows need the studio's Go live. Uploaded videos and links play here; browser-only files don't. The fill runs around the clock, which uses server CPU.
        {note && <><br /><strong>{note}</strong></>}
      </p>
    </section>
  )
}

// The videos a break plays once (or a playlist slot loops), picked like playlist items:
// uploaded videos or links.
function BreakVideos({ items, onChange, library, onUploaded, setMessage, label = 'Break videos (play once, in order)', noun = 'break' }: {
  label?: string
  noun?: string
  items: PlaylistItem[]
  onChange: (items: PlaylistItem[]) => void
  library: MediaLibrary | null
  onUploaded: () => void
  setMessage: (text: string) => void
}) {
  const [mediaId, setMediaId] = useState('')
  const [uploading, setUploading] = useState(false)
  const uploadInput = useRef<HTMLInputElement>(null)

  const update = (index: number, patch: Partial<PlaylistItem>) => onChange(items.map((item, i) => i === index ? { ...item, ...patch } : item))
  const move = (index: number, offset: number) => {
    const next = [...items]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  function addFromLibrary() {
    const media = library?.items.find((item) => item.id === mediaId)
    if (!media) return
    const durationMinutes = Math.round(((media.durationSeconds ?? 0) / 60) * 100) / 100
    onChange([...items, { id: newId(), title: media.name.replace(/\.[^.]+$/, '').slice(0, 120), url: null, mediaId: media.id, fileName: media.name, durationMinutes }])
    setMediaId('')
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (!files.length) return
    setUploading(true)
    const added: PlaylistItem[] = []
    try {
      for (const [index, file] of files.entries()) {
        const durationMinutes = await videoMinutes(file)
        const media = await uploadMedia(file, (fraction) => setMessage(`Uploading ${file.name} (${index + 1} of ${files.length}) · ${Math.round(fraction * 100)}%`), durationMinutes)
        added.push({ id: newId(), title: file.name.replace(/\.[^.]+$/, '').slice(0, 120), url: null, mediaId: media.id, fileName: media.name, durationMinutes })
      }
      setMessage(`${added.length} video${added.length > 1 ? 's' : ''} uploaded and added to the ${noun}.`)
    } catch (caught) {
      setMessage(errorMessage(caught))
    } finally {
      onChange([...items, ...added])
      setUploading(false)
      onUploaded()
    }
  }

  return (
    <div className="field-label">{label}
      {items.length === 0 ? (
        <p className="empty-note">No videos yet. Add uploaded videos, upload new ones, or add a link.</p>
      ) : (
        <ol className="playlist-items">
          {items.map((item, index) => (
            <li key={item.id ?? index} className="playlist-item">
              <span className="channel-number">{String(index + 1).padStart(2, '0')}</span>
              <div className="playlist-item-fields">
                <input className="text-input" placeholder="Title" aria-label={`Video ${index + 1} title`} value={item.title} onChange={(event) => update(index, { title: event.target.value })} maxLength={120} />
                {item.mediaId ? (
                  <span className="file-pill server" title={item.fileName}><Server size={13} /> <span>{item.fileName}</span><small>ON SERVER</small></span>
                ) : (
                  <input className="text-input" placeholder="https://media.example/video.mp4" aria-label={`Video ${index + 1} URL`} type="url" value={item.url ?? ''} onChange={(event) => update(index, { url: event.target.value })} />
                )}
                <label className="minutes-field">
                  <input className="text-input" type="number" min="0" max="1440" step="0.25" aria-label={`Video ${index + 1} minutes`} value={item.durationMinutes} onChange={(event) => update(index, { durationMinutes: Number(event.target.value) })} />
                  <span>MIN</span>
                </label>
              </div>
              <div className="playlist-item-actions">
                <button className="dash-icon-button light" type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up"><ArrowUp size={13} /></button>
                <button className="dash-icon-button light" type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Move down"><ArrowDown size={13} /></button>
                <button className="dash-icon-button light danger" type="button" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label="Remove video"><X size={13} /></button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="playlist-loader">
        <select className="text-input" aria-label="Uploaded video to add" value={mediaId} onChange={(event) => setMediaId(event.target.value)}>
          <option value="">{library?.items.length ? 'Choose an uploaded video…' : 'No uploaded videos yet'}</option>
          {library?.items.map((media) => <option key={media.id} value={media.id}>{media.name}</option>)}
        </select>
        <button className="capture-button" type="button" onClick={addFromLibrary} disabled={!mediaId}><Plus size={14} /> ADD</button>
      </div>
      <div className="capture-actions">
        <button className="capture-button primary" type="button" onClick={() => uploadInput.current?.click()} disabled={uploading}><Upload size={14} /> UPLOAD VIDEOS</button>
        <button className="capture-button" type="button" onClick={() => onChange([...items, { id: newId(), title: '', url: '', durationMinutes: 0 }])}><Link2 size={14} /> ADD LINK</button>
        <input ref={uploadInput} type="file" accept="video/*" multiple hidden onChange={(event) => void upload(event)} />
      </div>
    </div>
  )
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
    playlistSource: 'playlist',
    items: [],
    repeat: emptyRepeat(start.toISOString()),
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
  const [library, setLibrary] = useState<MediaLibrary | null>(null)

  function loadLibrary() {
    api<MediaLibrary>('/studio/media').then(setLibrary).catch(() => undefined)
  }

  useEffect(() => {
    api<MediaLibrary>('/studio/media').then(setLibrary).catch(() => undefined)
  }, [])

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
      playlistSource: entry.kind === 'playlist' && entry.items ? 'videos' : 'playlist',
      items: (entry.items ?? []).map((item) => ({ ...item })),
      repeat: entry.repeat
        ? { ...entry.repeat, untilTime: entry.repeat.untilTime ?? '17:00', endDate: entry.repeat.endDate ?? '' }
        : emptyRepeat(entry.start),
    })
    setMessage('')
  }

  function reset() {
    setEditingId(null)
    setDraft(emptyDraft())
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const items = draft.items.filter((item) => item.title.trim() || item.url?.trim() || item.mediaId)
    const ownVideos = draft.kind === 'playlist' && draft.playlistSource === 'videos'
    if (ownVideos) {
      const problem = !items.length ? 'Add at least one video link or upload to this slot.'
        : items.findIndex((item) => !item.title.trim()) >= 0 ? `Video ${items.findIndex((item) => !item.title.trim()) + 1} needs a title.`
          : items.findIndex((item) => !item.mediaId && !item.url?.trim()) >= 0 ? `Video ${items.findIndex((item) => !item.mediaId && !item.url?.trim()) + 1} needs a link.`
            : null
      if (problem) {
        setMessage(problem)
        return
      }
    }
    if (draft.kind === 'break') {
      const problem = !items.length ? 'Add at least one video to the break.'
        : items.findIndex((item) => !item.title.trim()) >= 0 ? `Video ${items.findIndex((item) => !item.title.trim()) + 1} needs a title.`
          : items.findIndex((item) => !item.mediaId && !item.url?.trim()) >= 0 ? `Video ${items.findIndex((item) => !item.mediaId && !item.url?.trim()) + 1} needs a link.`
            : null
      const repeatProblem = draft.repeat.frequency === 'weekly' && !draft.repeat.weekdays.length ? 'Choose at least one day of the week.'
        : draft.repeat.everyMinutes && (draft.repeat.everyMinutes < 5 || draft.repeat.everyMinutes > 720) ? 'Repeat during the day must be every 5 to 720 minutes.'
          : draft.repeat.everyMinutes && draft.repeat.everyMinutes < totalMinutes(items) ? `The break is ${Math.ceil(totalMinutes(items))} minutes long, so it can't repeat every ${draft.repeat.everyMinutes} minutes.`
            : null
      if (problem || repeatProblem) {
        setMessage(problem ?? repeatProblem ?? '')
        return
      }
    }
    setBusy(true)
    setMessage('')
    try {
      const body = {
        ...draft,
        start: new Date(draft.start).toISOString(),
        end: new Date(draft.end).toISOString(),
        playlistId: draft.kind === 'playlist' && !ownVideos ? draft.playlistId : null,
        source: ownVideos ? 'videos' : undefined,
        items: draft.kind === 'break' || ownVideos ? items : undefined,
        repeat: draft.kind === 'break' ? repeatBody(draft.repeat) : undefined,
      }
      await api(editingId ? `/studio/schedule/${editingId}` : '/studio/schedule', { method: editingId ? 'PUT' : 'POST', body })
      setMessage(draft.kind === 'break' ? 'Break saved. It plays when its time comes while the schedule is on in Go live.' : editingId ? 'Slot updated.' : 'Slot added to the schedule.')
      reset()
      await load()
    } catch (caught) {
      setMessage(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function remove(entry: ScheduleEntry) {
    const repeats = entry.repeat && entry.repeat.frequency !== 'once'
    if (!window.confirm(repeats ? `Remove the repeating break "${entry.title}"? Every repeat is removed.` : `Remove "${entry.title}" from the schedule?`)) return
    try {
      await api(`/studio/schedule/${entry.id}`, { method: 'DELETE' })
      if (editingId === entry.id) reset()
      await load()
    } catch (caught) {
      setMessage(errorMessage(caught))
    }
  }

  const now = new Date().toISOString()
  const isRepeating = (entry: ScheduleEntry) => Boolean(entry.repeat && entry.repeat.frequency !== 'once')
  const repeating = entries.filter((entry) => isRepeating(entry) && (showPast || !entry.finished))
  const visible = (showPast ? entries : entries.filter((entry) => entry.end > now)).filter((entry) => !isRepeating(entry))
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

      <OffAirChannel playlists={playlists} />

      <div className="split-grid">
        <form className="control-panel schedule-form" onSubmit={save}>
          <div className="control-panel-heading">
            <h2>{editingId ? 'Edit slot' : 'New slot'}</h2>
            {editingId && <button className="text-link" type="button" onClick={reset}><X size={12} /> CANCEL</button>}
          </div>
          <div className="graphics-form">
            <label className="field-label">Program title
              <input className="text-input" value={draft.title} onChange={(event) => update('title', event.target.value)} maxLength={120} required />
            </label>
            <div className="field-label">Type
              <div className="transition-options" role="group" aria-label="Slot type">
                {(['live', 'playlist', 'break'] as const).map((kind) => (
                  <button key={kind} type="button" className={draft.kind === kind ? 'transition-option selected' : 'transition-option'} aria-pressed={draft.kind === kind} onClick={() => update('kind', kind)}>
                    {KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
            </div>
            <div className="date-time-stack">
              <DateTimeFields label={draft.kind === 'break' && draft.repeat.frequency !== 'once' ? 'First break' : 'Starts'} value={draft.start} onChange={(value) => update('start', value)} />
              {draft.kind === 'break' ? (
                <div className="field-label">Ends about
                  <span className="computed-end">
                    {draft.start ? formatTime(new Date(Date.parse(draft.start) + (totalMinutes(draft.items) || 1) * 60000).toISOString()) : '—'}
                    <small>{totalMinutes(draft.items).toFixed(1)} MIN OF VIDEO</small>
                  </span>
                </div>
              ) : (
                <DateTimeFields label="Ends" value={draft.end} onChange={(value) => update('end', value)} />
              )}
            </div>
            {draft.kind === 'break' && (
              <>
                <RepeatFields repeat={draft.repeat} start={draft.start} onChange={(repeat) => update('repeat', repeat)} />
                <p className="empty-note">A break interrupts whatever is on air in Go live (the playlist or a live show), plays these videos once, then goes back to what it paused.</p>
                <BreakVideos items={draft.items} onChange={(items) => update('items', items)} library={library} onUploaded={loadLibrary} setMessage={setMessage} />
              </>
            )}
            {draft.kind === 'playlist' && (
              <>
                <div className="field-label">What plays
                  <div className="transition-options" role="group" aria-label="What the slot plays">
                    {([['playlist', 'SAVED PLAYLIST'], ['videos', 'VIDEO LINKS / UPLOADS']] as const).map(([source, label]) => (
                      <button key={source} type="button" className={draft.playlistSource === source ? 'transition-option selected' : 'transition-option'} aria-pressed={draft.playlistSource === source} onClick={() => update('playlistSource', source)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {draft.playlistSource === 'playlist' ? (
                  <label className="field-label">Playlist
                    <select className="text-input" value={draft.playlistId} onChange={(event) => update('playlistId', event.target.value)} required>
                      <option value="">{playlists.length ? 'Choose a playlist…' : 'Create a playlist first'}</option>
                      {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <>
                    <p className="empty-note">Paste video links (MP4, M3U8/HLS or WebM, starting with https://) or upload videos. They play in order and loop until the slot ends.</p>
                    <BreakVideos items={draft.items} onChange={(items) => update('items', items)} library={library} onUploaded={loadLibrary} setMessage={setMessage} label="Videos (play in order, loop until the slot ends)" noun="slot" />
                  </>
                )}
              </>
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
          {repeating.length > 0 && (
            <div className="schedule-day">
              <h3>Repeating breaks</h3>
              <ol className="rundown">
                {repeating.map((entry) => {
                  const nowPlay = entry.occurrences?.find((time) => time.start <= now && time.end > now)
                  const nextPlay = entry.occurrences?.find((time) => time.start > now)
                  return (
                    <li key={entry.id} className={[nowPlay ? 'current' : '', entry.id === editingId ? 'editing' : '', 'is-break rundown-row'].join(' ')}>
                      <span className="rundown-time"><Repeat size={13} /></span>
                      <span className="rundown-copy">
                        <strong>{entry.title}</strong>
                        <small>{repeatSummary(entry.repeat, entry.start)}</small>
                        <small>
                          {entry.finished ? 'FINISHED'
                            : nextPlay ? `NEXT · ${formatDay(nextPlay.start)} ${formatTime(nextPlay.start)}`
                              : 'NEXT · MORE THAN 2 DAYS AWAY'}
                          {' · '}{describeEntry(entry)}
                        </small>
                      </span>
                      {nowPlay && <span className="pill pill-live">NOW</span>}
                      <button className="dash-icon-button light" type="button" onClick={() => edit(entry)} aria-label={`Edit ${entry.title}`}><Pencil size={13} /></button>
                      <button className="dash-icon-button light danger" type="button" onClick={() => void remove(entry)} aria-label={`Delete ${entry.title}`}><Trash2 size={13} /></button>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
          {days.size === 0 && repeating.length === 0 ? (
            <p className="empty-note">No programs scheduled yet.</p>
          ) : (
            [...days].map(([day, dayEntries]) => (
              <div key={day} className="schedule-day">
                <h3>{day}</h3>
                <ol className="rundown">
                  {dayEntries.map((entry) => {
                    const isNow = entry.start <= now && entry.end > now
                    return (
                      <li key={entry.id} className={[isNow ? 'current' : '', entry.id === editingId ? 'editing' : '', entry.kind === 'break' ? 'is-break' : '', 'rundown-row'].join(' ')}>
                        <span className="rundown-time">{formatTime(entry.start)}<br />{formatTime(entry.end)}</span>
                        <span className="rundown-copy">
                          <strong>{entry.title}</strong>
                          <small>{describeEntry(entry)}</small>
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
