import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, PhoneOff, Trash2, UserPlus, Users } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useSwitcher } from './switcherContext'

type Invite = { id: string; name: string; token: string; createdAt: string; connected: boolean }

const inviteLink = (token: string) => `${window.location.origin}/guest/${token}`

const STEPS = [
  { title: 'Create an invite link', text: 'Type the guest\'s name below and press CREATE LINK. Each guest gets their own private link.' },
  { title: 'Send the link', text: 'Press COPY and send it by text, email or chat. The guest opens it in Chrome, Edge or Safari on a computer or phone. No app or account is needed.' },
  { title: 'The guest joins', text: 'They allow their camera and microphone, check how they look, and press JOIN. They appear in the list below and in the Input bank on Go live.' },
  { title: 'Put them on air', text: 'On Go live, press ADD CAMERA and choose Split screen or Corner screen. The guest goes into the empty screen automatically. Or click their tile to show them full screen. Then TAKE as usual.' },
  { title: 'Talk to them', text: 'Guests hear your studio mic (turn MIC ON) and see PROGRAM, so they know when they are on. You hear them on this computer: wear headphones so they don\'t hear an echo.' },
]

function GuestsPage() {
  const { guests, guestLinkOpen, removeGuest, sources, selectPreview } = useSwitcher()
  const [invites, setInvites] = useState<Invite[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const refresh = useCallback(() => api<Invite[]>('/studio/guests').then(setInvites).catch(() => undefined), [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      setInvites(await api<Invite[]>('/studio/guests', { method: 'POST', body: { name } }))
      setName('')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (invite: Invite) => {
    if (!window.confirm(`Delete the invite for ${invite.name}? The link stops working${invite.connected ? ' and they are disconnected' : ''}.`)) return
    try {
      setInvites(await api<Invite[]>(`/studio/guests/${invite.id}`, { method: 'DELETE' }))
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const copy = async (invite: Invite) => {
    try {
      await navigator.clipboard.writeText(inviteLink(invite.token))
      setCopied(invite.id)
      window.setTimeout(() => setCopied((current) => current === invite.id ? '' : current), 2000)
    } catch {
      setError('Copying was blocked. Select the link and copy it by hand.')
    }
  }

  const placed = new Set(sources.flatMap((source) => source.layout?.slots ?? []))

  return (
    <main className="studio-page">
      <header className="studio-heading">
        <div>
          <div className="eyebrow"><Users size={13} /> GGTV STUDIO <span>/</span> GUESTS</div>
          <h1>Guests</h1>
        </div>
        <div className="heading-badges">
          <div className={guests.length ? 'studio-mode output-streaming' : 'studio-mode output-idle'}>
            <span className="status-light" /> {guests.length} GUEST{guests.length === 1 ? '' : 'S'} CONNECTED
          </div>
        </div>
      </header>

      <section className="control-panel">
        <div className="control-panel-heading"><h2>How to invite a guest</h2><span>VIDEO LINK</span></div>
        <ol className="guide-steps">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="guide-number">{index + 1}</span>
              <span><strong>{step.title}</strong><small>{step.text}</small></span>
            </li>
          ))}
        </ol>
        <p className="empty-note">
          Keep the <Link to="/studio/live">Go live</Link> page's browser tab open: guests connect to this studio browser.
          Opening the studio in a second tab moves guests to that tab.
        </p>
      </section>

      <div className="studio-lower-grid">
        <section className="control-panel">
          <div className="control-panel-heading"><h2>Invite links</h2><span>{invites.length} SAVED</span></div>
          <form className="invite-form" onSubmit={(event) => void create(event)}>
            <input className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Guest name, e.g. Jane Doe" maxLength={60} required aria-label="Guest name" />
            <button className="button button-primary" type="submit" disabled={busy}><UserPlus size={14} /> CREATE LINK</button>
          </form>
          {error && <p className="form-error">{error}</p>}
          {invites.length === 0 ? (
            <p className="empty-note">No invites yet.</p>
          ) : (
            <ul className="invite-list">
              {invites.map((invite) => (
                <li key={invite.id}>
                  <div className="invite-top">
                    <strong>{invite.name}</strong>
                    <span className={invite.connected ? 'pill pill-live' : 'pill'}>{invite.connected ? 'JOINED' : 'NOT JOINED'}</span>
                  </div>
                  <div className="invite-link">
                    <input className="text-input" value={inviteLink(invite.token)} readOnly onFocus={(event) => event.target.select()} aria-label={`Invite link for ${invite.name}`} />
                    <button className="capture-button" type="button" onClick={() => void copy(invite)}>
                      {copied === invite.id ? <><Check size={13} /> COPIED</> : <><Copy size={13} /> COPY</>}
                    </button>
                    <button className="dash-icon-button light" type="button" onClick={() => void remove(invite)} aria-label={`Delete the invite for ${invite.name}`} title="Delete invite"><Trash2 size={13} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="control-panel">
          <div className="control-panel-heading"><h2>In the studio now</h2><span>{guestLinkOpen ? 'READY FOR GUESTS' : 'CONNECTING…'}</span></div>
          {guests.length === 0 ? (
            <p className="empty-note">Nobody has joined yet. Guests appear here as soon as they press JOIN.</p>
          ) : (
            <ul className="invite-list">
              {guests.map((guest) => {
                const source = sources.find((item) => item.id === `guest-${guest.guestId}`)
                const status = guest.state === 'failed'
                  ? 'Could not connect. Their network may block video calls.'
                  : !source ? 'Connecting…'
                    : placed.has(source.id) ? 'In a layout screen' : 'Connected: not in a layout'
                return (
                  <li key={guest.guestId}>
                    <div className="invite-top">
                      <strong>{guest.name}</strong>
                      <span className={guest.state === 'failed' ? 'pill pill-error' : source ? 'pill pill-live' : 'pill'}>{guest.state === 'failed' ? 'FAILED' : source ? 'LIVE VIDEO' : 'JOINING'}</span>
                    </div>
                    <small className="guest-status">{status}</small>
                    <div className="graphics-actions">
                      {source && <Link className="button button-muted" to="/studio/live" onClick={() => selectPreview(source)}>SHOW ON PREVIEW</Link>}
                      <button className="button button-danger" type="button" onClick={() => removeGuest(guest.guestId)}><PhoneOff size={13} /> HANG UP</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

export default GuestsPage
