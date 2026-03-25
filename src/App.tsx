import { useState, useEffect, useRef, useCallback } from 'react'
import { onAuthChange, getIdToken, signOut } from './lib/auth'
import { HilbertSocket } from './lib/ws'
import type { View, SessionMeta, ServerMessage, StreamEvent, SessionOrigin } from './lib/types'
import { LoginView } from './views/LoginView'
import { GalleryView } from './views/GalleryView'
import { ChatView } from './views/ChatView'
import { LocalChatView } from './views/LocalChatView'
import type { User } from 'firebase/auth'
import './App.css'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [view, setView] = useState<View>({ name: 'login' })
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected')
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [activeSessionName, setActiveSessionName] = useState('')
  const [initialHistory, setInitialHistory] = useState<Array<{role: string, content: string}>>([])
  const streamHandlerRef = useRef<((event: StreamEvent) => void) | null>(null)

  const socketRef = useRef<HilbertSocket | null>(null)

  // Auth state
  useEffect(() => {
    return onAuthChange((u) => {
      setUser(u)
      setAuthLoading(false)
      if (u) {
        setView({ name: 'gallery' })
      } else {
        setView({ name: 'login' })
      }
    })
  }, [])

  // WS message handler
  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'sessions_list':
        setSessions(msg.sessions)
        setSessionsLoading(false)
        break
      case 'session_created':
        setView({ name: 'chat', sessionId: msg.sessionId })
        setActiveSessionName(msg.name)
        break
      case 'session_resumed':
        setInitialHistory(msg.history || [])
        setView({ name: 'chat', sessionId: msg.sessionId })
        break
      case 'stream_event':
        streamHandlerRef.current?.(msg.event)
        break
      case 'error':
        console.error('[ws] Error:', msg.message)
        if (msg.code === 'SESSION_DEAD') {
          // Session process died, go back to gallery
        }
        break
      case 'pong':
        break
    }
  }, [])

  // Connect WS when authenticated
  useEffect(() => {
    if (!user) {
      socketRef.current?.disconnect()
      socketRef.current = null
      return
    }

    const socket = new HilbertSocket(getIdToken, handleMessage, setWsStatus)
    socketRef.current = socket
    socket.connect()

    return () => {
      socket.disconnect()
    }
  }, [user, handleMessage])

  // Load sessions when gallery is shown and WS connected
  useEffect(() => {
    if (view.name === 'gallery' && wsStatus === 'connected') {
      setSessionsLoading(true)
      socketRef.current?.send({ type: 'list_sessions' })
    }
  }, [view.name, wsStatus])

  // Fetch remote CC sessions from Supabase (local Mac, cloud)
  const [remoteSessions, setRemoteSessions] = useState<SessionMeta[]>([])
  useEffect(() => {
    if (view.name !== 'gallery') return
    const SUPABASE_URL = 'https://aquysbccogwqloydoymz.supabase.co'
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxdXlzYmNjb2d3cWxveWRveW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NzY1NzYsImV4cCI6MjA4NTU1MjU3Nn0.IV08zf40TK-NPOB_OyTRPcCdRA9AxkNzhKV17JL3jAU'
    const EMAIL = 'yebomnt@gmail.com'
    fetch(`${SUPABASE_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(EMAIL)}&select=cc_sessions`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'x-user-email': EMAIL },
    })
      .then(r => r.json())
      .then(rows => {
        const ccSessions = (rows?.[0]?.cc_sessions || []) as Array<{
          id: string; name: string; type: string; status: string; lastSeen: string; lastMessage?: string
        }>
        setRemoteSessions(ccSessions.map(s => ({
          id: `remote-${s.id}`,
          name: s.name,
          createdAt: new Date(s.lastSeen).getTime(),
          lastActiveAt: new Date(s.lastSeen).getTime(),
          status: (Date.now() - new Date(s.lastSeen).getTime() < 5 * 60_000 ? 'active' : 'resumable') as 'active' | 'resumable',
          origin: s.type as SessionMeta['origin'],
        })))
      })
      .catch(() => {})
  }, [view.name])

  const handleNewSession = () => {
    socketRef.current?.send({ type: 'new_session' })
  }

  const handleNewLocalSession = async () => {
    const SUPABASE_URL = 'https://aquysbccogwqloydoymz.supabase.co'
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxdXlzYmNjb2d3cWxveWRveW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NzY1NzYsImV4cCI6MjA4NTU1MjU3Nn0.IV08zf40TK-NPOB_OyTRPcCdRA9AxkNzhKV17JL3jAU'
    const EMAIL = 'yebomnt@gmail.com'
    const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'x-user-email': EMAIL, 'Content-Type': 'application/json', Prefer: 'return=minimal' }

    // Optimistic UI: add pending session immediately
    const pendingId = `pending-${Date.now()}`
    setRemoteSessions(prev => [{
      id: pendingId,
      name: 'Mac',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      status: 'resumable' as const,
      origin: 'local' as SessionOrigin,
      pending: true,
    }, ...prev])

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(EMAIL)}&select=cc_commands`, { headers })
      const rows = await res.json()
      const commands = rows?.[0]?.cc_commands || []
      commands.push({ action: 'start_session', target: 'local', ts: new Date().toISOString(), id: crypto.randomUUID() })
      await fetch(`${SUPABASE_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(EMAIL)}`, {
        method: 'PATCH', headers, body: JSON.stringify({ cc_commands: commands }),
      })
    } catch (e) {
      console.error('[local session] failed:', e)
      // Remove pending on failure
      setRemoteSessions(prev => prev.filter(s => s.id !== pendingId))
    }
  }

  const handleSelectSession = (id: string) => {
    // Local/remote sessions (from Supabase) have id prefixed with "remote-" or "pending-"
    const allSessions = [
      ...sessions.map(s => ({ ...s, origin: 'vps' as SessionOrigin })),
      ...remoteSessions,
    ]
    const session = allSessions.find(s => s.id === id)
    setActiveSessionName(session?.name || 'Session')

    if (session?.origin === 'local' || session?.origin === 'cloud') {
      // Extract the Supabase session_id (strip "remote-" prefix from cc_sessions id)
      const sbSessionId = id.replace('remote-', '')
      setView({ name: 'local-chat', sessionId: sbSessionId })
    } else {
      socketRef.current?.send({ type: 'resume_session', sessionId: id })
    }
  }

  const handleSendMessage = (text: string) => {
    socketRef.current?.send({ type: 'send_message', text })
  }

  const handleBack = () => {
    setView({ name: 'gallery' })
    streamHandlerRef.current = null
  }

  const handleSignOut = async () => {
    socketRef.current?.disconnect()
    socketRef.current = null
    await signOut()
    setView({ name: 'login' })
  }

  if (authLoading) {
    return (
      <div className="app">
        <div className="auth-loading">Loading...</div>
      </div>
    )
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          {(view.name === 'chat' || view.name === 'local-chat') && (
            <button className="back-button" onClick={handleBack} title="Back to sessions">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <div className="header-logo">H</div>
          <div>
            <div className="header-title">
              {view.name === 'chat' ? activeSessionName : 'Hilbert Talk'}
            </div>
            <div className="header-subtitle">claude @ vps</div>
          </div>
        </div>
        <div className="header-right">
          <div className="connection-status">
            <span className={`status-dot ${wsStatus === 'connected' ? 'connected' : wsStatus === 'connecting' ? '' : 'error'}`} />
            {wsStatus}
          </div>
          {user && (
            <button className="sign-out-btn" onClick={handleSignOut} title="Sign out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Views */}
      {view.name === 'login' && (
        <LoginView onSignedIn={() => setView({ name: 'gallery' })} />
      )}

      {view.name === 'gallery' && (
        <GalleryView
          sessions={[
            ...sessions.map(s => ({ ...s, origin: 'vps' as SessionOrigin })),
            ...remoteSessions,
          ]}
          onNewSession={handleNewSession}
          onNewLocalSession={handleNewLocalSession}
          onSelectSession={handleSelectSession}
          loading={sessionsLoading}
        />
      )}

      {view.name === 'chat' && (
        <ChatView
          onSendMessage={handleSendMessage}
          onStreamHandler={(handler) => { streamHandlerRef.current = handler }}
          initialHistory={initialHistory}
        />
      )}

      {view.name === 'local-chat' && (
        <LocalChatView
          sessionId={view.sessionId}
          onHandoverToVPS={(history) => {
            // Start a VPS session with local context injected
            const context = history.map(m => `${m.role}: ${m.content}`).join('\n').slice(-2000)
            setInitialHistory([{ role: 'system', content: `Continuing from a local Mac session. Here's the recent context:\n\n${context}` }])
            socketRef.current?.send({ type: 'new_session' })
          }}
        />
      )}
    </div>
  )
}

export default App
