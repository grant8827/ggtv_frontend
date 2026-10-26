import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ArrowDown, ArrowUp, FileVideo, HardDrive, ListPlus, Plus, Save, Server, Trash2, Upload, X } from 'lucide-react'
import { api, errorMessage, uploadMedia, type MediaFile, type MediaLibrary, type Playlist, type PlaylistItem } from '../api'
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
    if (item.fileId || item.mediaId) continue
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
  const uploadInput = useRef<HTMLInputElement>(null)
  const [library, setLibrary] = useState<MediaLibrary | null>(null)

  function loadLibrary() {
    api<MediaLibrary>('/studio/media').then(setLibrary).catch(() => undefined)
  }

  useEffect(() => {
    api<MediaLibrary>('/studio/media').then(setLibrary).catch(() => undefined)
  }, [])

  function addItems(added: PlaylistItem[]) {
    // Replace the empty starter row instead of keeping it above the new videos.
    setDraft((current) => current && {
      ...current,
      items: [...current.items.filter((item) => item.title.trim() || item.url?.trim() || item.fileId || item.mediaId), ...added],
    })
  }

  const titleFrom = (fileName: string) => fileName.replace(/\.[^.]+$/, '').slice(0, 120)

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (!files.length) return
    setBusy(true)
    setIsError(false)
    const added: PlaylistItem[] = []
    try {
      for (const [index, file] of files.entries()) {
        const durationMinutes = await videoMinutes(file)
        const media = await uploadMedia(file, (fraction) => {
          setMessage(`Uploading ${file.name} (${index + 1} of ${files.length}) · ${Math.round(fraction * 100)}%`)
        }, durationMinutes)
        added.push({ id: newId(), title: titleFrom(file.name), url: null, mediaId: media.id, fileName: media.name, durationMinutes })
      }
      setMessage(`${files.length} video${files.length > 1 ? 's' : ''} uploaded. Save the playlist to add ${files.length > 1 ? 'them' : 'it'}.`)
    } catch (caught) {
      setIsError(true)
      setMessage(`${added.length ? `${added.length} uploaded, then: ` : ''}${errorMessage(caught)}`)
    } finally {
      addItems(added)
      setBusy(false)
      loadLibrary()
    }
  }

  function addFromLibrary(media: MediaFile) {
    const durationMinutes = Math.round(((media.durationSeconds ?? 0) / 60) * 100) / 100
    addItems([{ id: newId(), title: titleFrom(media.name), url: null, mediaId: media.id, fileName: media.name, durationMinutes }])
  }

  async function deleteMedia(media: MediaFile) {
    if (!window.confirm(`Delete "${media.name}" from the server? This can't be undone.`)) return
    try {
      await api(`/studio/media/${media.id}`, { method: 'DELETE' })
      loadLibrary()
    } catch (caught) {
      setIsError(true)
      setMessage(errorMessage(caught))
    }
  }
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
          title: titleFrom(file.name),
          url: null,
          fileId: stored.id,
          fileName: file.name.slice(0, 200),
          durationMinutes: await videoMinutes(file),
        })
      }
      addItems(added)
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
    const items = draft.items.filter((item) => item.title.trim() || item.url?.trim() || item.fileId || item.mediaId)
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
      loadLibrary()
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
          <div className="control-panel-heading media-heading">
            <h2><Server size={14} /> Server media</h2>
            <span>{library ? `${formatBytes(library.used)} USED · ${formatBytes(library.free)} FREE` : ''}</span>
          </div>
          {!library?.items.length ? (
            <p className="empty-note">Videos you upload appear here and can be reused in any playlist.</p>
          ) : (
            <ul className="media-list">
              {library.items.map((media) => (
                <li key={media.id}>
                  <span className="loaded-name">
                    <strong title={media.name}>{media.name}</strong>
                    <small>{formatBytes(media.size)} · {media.usedBy.length ? `in ${media.usedBy.join(', ')}` : 'not in a playlist'}</small>
                  </span>
                  {draft && (
                    <button className="dash-icon-button light" type="button" onClick={() => addFromLibrary(media)} aria-label={`Add ${media.name} to this playlist`} title="Add to the open playlist"><Plus size={13} /></button>
                  )}
                  <button className="dash-icon-button light danger" type="button" onClick={() => void deleteMedia(media)} disabled={media.usedBy.length > 0} aria-label={`Delete ${media.name}`} title={media.usedBy.length ? 'Remove it from its playlists first' : 'Delete from the server'}><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
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
                      {item.mediaId ? (
                        <span className="file-pill server" title={item.fileName}>
                          <Server size={13} /> <span>{item.fileName}</span><small>ON SERVER</small>
                        </span>
                      ) : item.fileId ? (
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
                <button className="capture-button primary" type="button" onClick={() => uploadInput.current?.click()} disabled={busy}>
                  <Upload size={14} /> UPLOAD VIDEOS
                </button>
                <button className="capture-button" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
                  <HardDrive size={14} /> ADD TO THIS BROWSER ONLY
                </button>
                <button className="capture-button" type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, blankItem()] })}>
                  <ListPlus size={14} /> ADD LINK
                </button>
                <input ref={uploadInput} type="file" accept="video/*" multiple hidden onChange={(event) => void uploadFiles(event)} />
                <input ref={fileInput} type="file" accept="video/*" multiple hidden onChange={(event) => void addFiles(event)} />
              </div>
              <p className="empty-note">
                Uploaded videos are stored on the server and play everywhere: on schedule and in the Switcher. Browser-only files play from the Switcher on this computer, and scheduled playout skips them.
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
