import { useState } from 'react'
import type { SessionMeta } from '../lib/types'

interface GalleryViewProps {
  sessions: SessionMeta[]
  onNewSession: () => void
  onNewLocalSession: () => void
  onSelectSession: (id: string) => void
  loading: boolean
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function GalleryView({ sessions, onNewSession, onNewLocalSession, onSelectSession, loading }: GalleryViewProps) {
  const [showChooser, setShowChooser] = useState(false)

  return (
    <div className="gallery-view">
      <div className="gallery-header">
        <h2>Sessions</h2>
        <button className="new-session-btn" onClick={() => setShowChooser(true)}>
          + New Session
        </button>
      </div>

      {/* Session target chooser */}
      {showChooser && (
        <div className="chooser-backdrop" onClick={() => setShowChooser(false)}>
          <div className="chooser-modal" onClick={e => e.stopPropagation()}>
            <div className="chooser-title">Where?</div>
            <div className="chooser-options">
              <button className="chooser-option" onClick={() => { setShowChooser(false); onNewSession() }}>
                <span className="chooser-icon origin-vps">VPS</span>
                <span className="chooser-label">VPS Claude</span>
                <span className="chooser-hint">Runs on Hetzner server</span>
              </button>
              <button className="chooser-option" onClick={() => { setShowChooser(false); onNewLocalSession() }}>
                <span className="chooser-icon origin-local">Mac</span>
                <span className="chooser-label">Local Mac</span>
                <span className="chooser-hint">Starts on your MacBook</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="gallery-loading">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="gallery-empty">
          <div className="empty-state-icon">H</div>
          <div className="empty-state-title">No sessions yet</div>
          <div className="empty-state-hint">
            Start a new conversation with Claude Code.
          </div>
          <button className="new-session-btn large" onClick={() => setShowChooser(true)}>
            + New Session
          </button>
        </div>
      ) : (
        <div className="sessions-list">
          {sessions.map(s => (
            <button
              key={s.id}
              className={`session-card${s.pending ? ' pending' : ''}`}
              onClick={() => !s.pending && onSelectSession(s.id)}
            >
              <div className="session-card-left">
                <span className={`status-dot ${s.pending ? 'pending' : s.status}`} />
                <span className="session-name">{s.pending ? 'Starting on Mac...' : s.name}</span>
                {s.origin && (
                  <span className={`origin-badge origin-${s.origin}`}>
                    {s.origin === 'local' ? 'Mac' : s.origin === 'vps' ? 'VPS' : 'Cloud'}
                  </span>
                )}
              </div>
              <span className="session-time">{s.pending ? 'Queued' : timeAgo(s.lastActiveAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
