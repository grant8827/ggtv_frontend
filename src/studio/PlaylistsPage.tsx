import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ArrowDown, ArrowUp, FileVideo, ListPlus, Plus, Save, Trash2, Upload, X } from 'lucide-react'
import { api, errorMessage, type Playlist, type PlaylistItem } from '../api'
import { formatBytes, hasFiles, saveFile, storageUsage, videoMinutes } from './mediaStore'

type Draft = { id: string | null; name: string; items: PlaylistItem[] }

const newId = () => `new-${Date.now()}-${Math.random().toString(36).slice(2)}`
const blankItem = (): PlaylistItem => ({ id: newId(), title: '', url: '', durationMinutes: 0 })

function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const mins = Math.round(totalMinutes % 60)
  return hours ? `${hours}h ${mins}m` : `${mins}m`
}

// Catches the common mistakes before the server does, with a message that says what to fix.
function problemWith(name: string, items: PlaylistItem[]) {
  if (!name.trim()) return 'Give the playlist a name.'
  for (const [index, item] of items.entries()) {
    const label = `Item ${index + 1}`
    if (!item.title.trim()) return `${label} needs a title.`
    if (item.fileId) continue
    if (!item.url?.trim()) return `${label} needs a video link.`
    let url: URL
    try {
      url = new URL(item.url.trim())
    } catch {
      return `${label}: the link must be a full address starting with https://`
    }
    if (!['http:', 'https:'].includes(url.protocol)) return `${label}: the link must start with http:// or https://`
    if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|facebook\.com|tiktok\.com)$/.test(url.hostname)) {
      return `${label}: ${url.hostname} links are web pages, not video files. Use a direct .mp4 or .m3u8 link.`
    }
  }
  return null
}

function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [storedHere, setStoredHere] = useState<Set<string>>(new Set())
  const [usage, setUsage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const fileIds = draft?.items.flatMap((item) => item.fileId ? [item.fileId] : []).join(',') ?? ''

  // Which of this playlist's files are in this browser's storage.
  useEffect(() => {
    if (!fileIds) return
    hasFiles(fileIds.split(',')).then(setStoredHere).catch(() => setStoredHere(new Set()))
  }, [fileIds])

  function refreshUsage() {
    storageUsage().then((estimate) => setUsage(estimate ? `${formatBytes(estimate.used)} of ${formatBytes(estimate.quota)} browser storage used` : '')).catch(() => undefined)
  }

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    setIsError(false)
    try {
      const added: PlaylistItem[] = []
      for (const [index, file] of files.entries()) {
        setMessage(`Storing ${file.name} in this browser (${index + 1} of ${files.length})…`)
        const stored = await saveFile(file)
        added.push({
          id: newId(),
          title: file.name.replace(/\.[^.]+$/, '').slice(0, 120),
          url: null,
          fileId: stored.id,
          fileName: file.name.slice(0, 200),
          durationMinutes: await videoMinutes(file),
        })
      }
      // Replace the empty starter row instead of keeping it above the new files.
      setDraft((current) => current && {
        ...current,
        items: [...current.items.filter((item) => item.title.trim() || item.url?.trim() || item.fileId), ...added],
      })
      setStoredHere((current) => new Set([...current, ...added.map((item) => item.fileId!)]))
      setMessage(`${files.length} video${files.length > 1 ? 's' : ''} added. Save the playlist to keep ${files.length > 1 ? 'them' : 'it'}.`)
    } catch (caught) {
      setIsError(true)
      setMessage(`Could not store the video in this browser: ${caught instanceof Error ? caught.message : 'unknown error'}`)
    } finally {
      setBusy(false)
      refreshUsage()
    }
  }

  async function load() {
    setPlaylists(await api<Playlist[]>('/studio/playlists'))
  }

  useEffect(() => {
    api<Playlist[]>('/studio/playlists')
      .then(setPlaylists)
      .catch((caught) => setMessage(errorMessage(caught)))
  }, [])

  function open(playlist: Playlist) {
    setDraft({ id: playlist.id, name: playlist.name, items: playlist.items.map((item) => ({ ...item })) })
    setMessage('')
  }

  function updateItem(index: number, patch: Partial<PlaylistItem>) {
    setDraft((current) => current && { ...current, items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item) })
  }

  function moveItem(index: number, offset: number) {
    setDraft((current) => {
      if (!current) return current
      const items = [...current.items]
      const target = index + offset
      if (target < 0 || target >= items.length) return current
      ;[items[index], items[target]] = [items[target], items[index]]
      return { ...current, items }
    })
  }

  function removeItem(index: number) {
    setDraft((current) => current && { ...current, items: current.items.filter((_, i) => i !== index) })
  }

  async function save() {
    if (!draft) return
    // Rows left completely empty (like the starter row) are dropped rather than rejected.
    const items = draft.items.filter((item) => item.title.trim() || item.url?.trim() || item.fileId)
    const problem = problemWith(draft.name, items)
    setIsError(Boolean(problem))
    setMessage(problem ?? '')
    if (problem) return
    setBusy(true)
    try {
      const body = { name: draft.name, items }
      const saved = await api<Playlist>(draft.id ? `/studio/playlists/${draft.id}` : '/studio/playlists', { method: draft.id ? 'PUT' : 'POST', body })
      await load()
      open(saved)
      setMessage('Playlist saved.')
    } catch (caught) {
      setIsError(true)
      setMessage(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!draft?.id || !window.confirm(`Delete the playlist "${draft.name}"?`)) return
    try {
      await api(`/studio/playlists/${draft.id}`, { method: 'DELETE' })
      setDraft(null)
      await load()
      setIsError(false)
      setMessage('Playlist deleted.')
    } catch (caught) {
      setIsError(true)
      setMessage(errorMessage(caught))
    }
  }

  const total = draft?.items.reduce((sum, item) => sum + (Number(item.durationMinutes) || 0), 0) ?? 0

  return (
    <main className="studio-page">
      <header className="studio-heading">
        <div>
          <div className="eyebrow">GGTV STUDIO <span>/</span> PLAYLISTS</div>
          <h1>Playlists</h1>
        </div>
        <button className="button button-primary" type="button" onClick={() => { setDraft({ id: null, name: '', items: [blankItem()] }); setMessage('') }}>
          <Plus size={14} /> NEW PLAYLIST
        </button>
      </header>

      <div className="split-grid playlists">
        <section className="control-panel">
          <div className="control-panel-heading"><h2>Library</h2><span>{String(playlists.length).padStart(2, '0')} LISTS</span></div>
          {playlists.length === 0 ? (
            <p className="empty-note">No playlists yet. Create one to schedule pre-recorded programming.</p>
          ) : (
            <div className="channel-list">
              {playlists.map((playlist) => (
                <button key={playlist.id} type="button" className={draft?.id === playlist.id ? 'channel-row selected' : 'channel-row'} onClick={() => open(playlist)} aria-pressed={draft?.id === playlist.id}>
                  <span className="channel-number">{String(playlist.items.length).padStart(2, '0')}</span>
                  <span className="channel-copy"><strong>{playlist.name}</strong><small>{formatDuration(playlist.items.reduce((sum, item) => sum + item.durationMinutes, 0))} · {playlist.items.length} ITEMS</small></span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="control-panel">
          {!draft ? (
            <p className="empty-note">Select a playlist to edit it, or create a new one.</p>
          ) : (
            <div className="graphics-form">
              <div className="control-panel-heading">
                <h2>{draft.id ? 'Edit playlist' : 'New playlist'}</h2>
                <span>{draft.items.length} ITEMS · {formatDuration(total)}</span>
              </div>
              <label className="field-label">Playlist name
                <input className="text-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} required />
              </label>

              <ol className="playlist-items">
                {draft.items.map((item, index) => (
                  <li key={item.id ?? index} className="playlist-item">
                    <span className="channel-number">{String(index + 1).padStart(2, '0')}</span>
                    <div className="playlist-item-fields">
                      <input className="text-input" placeholder="Title" aria-label={`Item ${index + 1} title`} value={item.title} onChange={(event) => updateItem(index, { title: event.target.value })} maxLength={120} />
                      {item.fileId ? (
                        <span className={storedHere.has(item.fileId) ? 'file-pill' : 'file-pill missing'} title={item.fileName}>
                          <FileVideo size={13} /> <span>{item.fileName}</span>
                          <small>{storedHere.has(item.fileId) ? 'IN THIS BROWSER' : 'NOT IN THIS BROWSER'}</small>
                        </span>
                      ) : (
                        <input className="text-input" placeholder="https://media.example/video.m3u8" aria-label={`Item ${index + 1} URL`} type="url" value={item.url ?? ''} onChange={(event) => updateItem(index, { url: event.target.value })} />
                      )}
                      <label className="minutes-field">
                        <input className="text-input" type="number" min="0" max="1440" step="1" aria-label={`Item ${index + 1} minutes`} value={item.durationMinutes} onChange={(event) => updateItem(index, { durationMinutes: Number(event.target.value) })} />
                        <span>MIN</span>
                      </label>
                    </div>
                    <div className="playlist-item-actions">
                      <button className="dash-icon-button light" type="button" onClick={() => moveItem(index, -1)} disabled={index === 0} aria-label="Move up"><ArrowUp size={13} /></button>
                      <button className="dash-icon-button light" type="button" onClick={() => moveItem(index, 1)} disabled={index === draft.items.length - 1} aria-label="Move down"><ArrowDown size={13} /></button>
                      <button className="dash-icon-button light danger" type="button" onClick={() => removeItem(index)} aria-label="Remove item"><X size={13} /></button>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="capture-actions">
                <button className="capture-button" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
                  <Upload size={14} /> ADD VIDEO FILES
                </button>
                <button className="capture-button" type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, blankItem()] })}>
                  <ListPlus size={14} /> ADD LINK
                </button>
                <input ref={fileInput} type="file" accept="video/*" multiple hidden onChange={(event) => void addFiles(event)} />
              </div>
              <p className="empty-note">
                Video files are stored in this browser only and play from the Switcher (Load playlist). Scheduled playout on the server plays the linked items only.
                {usage && <><br />{usage}</>}
              </p>

              <div className="graphics-actions">
                <button className="button button-primary" type="button" onClick={() => void save()} disabled={busy}><Save size={14} /> SAVE PLAYLIST</button>
                {draft.id && <button className="button button-muted" type="button" onClick={() => void remove()}><Trash2 size={13} /> DELETE</button>}
              </div>
            </div>
          )}
          {message && <p className={isError ? 'form-error playlist-message' : 'studio-message'} role={isError ? 'alert' : 'status'}>{message}</p>}
        </section>
      </div>
    </main>
  )
}

export default PlaylistsPage
