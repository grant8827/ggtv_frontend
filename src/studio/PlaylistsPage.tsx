import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ListPlus, Plus, Save, Trash2, X } from 'lucide-react'
import { api, errorMessage, type Playlist, type PlaylistItem } from '../api'

type Draft = { id: string | null; name: string; items: PlaylistItem[] }

const blankItem = (): PlaylistItem => ({ id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, title: '', url: '', durationMinutes: 0 })

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
    if (!item.url.trim()) return `${label} needs a video link.`
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
    const items = draft.items.filter((item) => item.title.trim() || item.url.trim())
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
                      <input className="text-input" placeholder="https://media.example/video.m3u8" aria-label={`Item ${index + 1} URL`} type="url" value={item.url} onChange={(event) => updateItem(index, { url: event.target.value })} />
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

              <button className="capture-button" type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, blankItem()] })}>
                <ListPlus size={14} /> ADD ITEM
              </button>

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
