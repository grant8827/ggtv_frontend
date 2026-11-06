import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

export function Popover({ title, children, onBack }: { title: string; children: ReactNode; onBack?: () => void }) {
  return (
    <div className="control-popover" role="dialog" aria-label={title}>
      <div className="control-popover-heading">
        {onBack && <button className="popover-back" type="button" onClick={onBack} aria-label="Back"><ArrowLeft size={13} /></button>}
        <strong>{title}</strong>
      </div>
      {children}
    </div>
  )
}
