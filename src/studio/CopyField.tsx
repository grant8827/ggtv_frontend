import { useState } from 'react'
import { Copy, Eye, EyeOff } from 'lucide-react'

// A read-only value with a copy button; secrets stay hidden until shown.
export default function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(!secret)
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <label className="field-label">{label}
      <span className="copy-field">
        <input className="text-input" readOnly value={revealed ? value : '•'.repeat(24)} />
        {secret && (
          <button className="dash-icon-button light" type="button" onClick={() => setRevealed((current) => !current)} aria-label={revealed ? 'Hide' : 'Show'}>
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        <button className="dash-icon-button light" type="button" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          <Copy size={14} />
        </button>
      </span>
      {copied && <small className="copy-note">Copied</small>}
    </label>
  )
}
