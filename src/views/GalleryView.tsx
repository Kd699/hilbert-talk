import type { SessionMeta } from '../lib/types'

interface GalleryViewProps {
  sessions: SessionMeta[]
  onNewSession: () => void
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

export function GalleryView({ sessions, onNewSession, onSelectSession, loading }: GalleryViewProps) {
  return (
    <div className="gallery-view">
      <div className="gallery-header">
        <h2>Sessions</h2>
        <button className="new-session-btn" onClick={onNewSession}>
          + New Session
        </button>
      </div>

      {loading ? (
        <div className="gallery-loading">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="gallery-empty">
          <div className="empty-state-icon">H</div>
          <div className="empty-state-title">No sessions yet</div>
          <div className="empty-state-hint">
            Start a new conversation with Claude Code on your VPS.
          </div>
          <button className="new-session-btn large" onClick={onNewSession}>
            + New Session
          </button>
        </div>
      ) : (
        <div className="sessions-list">
          {sessions.map(s => (
            <button
              key={s.id}
              className="session-card"
              onClick={() => onSelectSession(s.id)}
            >
              <div className="session-card-left">
                <span className={`status-dot ${s.status}`} />
                <span className="session-name">{s.name}</span>
              </div>
              <span className="session-time">{timeAgo(s.lastActiveAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
