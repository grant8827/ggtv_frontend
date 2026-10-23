import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, LockKeyhole, Radio } from 'lucide-react'
import { errorMessage } from '../api'
import { useAuth } from '../auth'

function LoginPage() {
  const { user, checking, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const from = (location.state as { from?: string } | null)?.from ?? '/studio'

  if (!checking && user) return <Navigate to={from} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await login(username, password)
      navigate(from, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-mark"><Radio size={18} strokeWidth={2.5} /></span>
          <span>GG<span className="brand-accent">TV</span> <span className="login-brand-sub">STUDIO</span></span>
        </div>
        <div>
          <h1>Studio sign in</h1>
          <p>Control room access for schedule, playlists and live broadcasts.</p>
        </div>

        <label className="field-label">Username
          <input className="text-input" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required autoFocus />
        </label>
        <label className="field-label">Password
          <input className="text-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="button button-primary login-submit" type="submit" disabled={submitting}>
          <LockKeyhole size={14} /> {submitting ? 'SIGNING IN…' : 'SIGN IN'}
        </button>
        <Link to="/" className="login-back"><ArrowLeft size={13} /> Back to the channel</Link>
      </form>
    </main>
  )
}

export default LoginPage
