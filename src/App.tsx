import { useState, useEffect, useRef, useCallback } from 'react'
import { onAuthChange, getIdToken, signOut } from './lib/auth'
import { HilbertSocket } from './lib/ws'
import type { View, SessionMeta, ServerMessage, StreamEvent } from './lib/types'
import { LoginView } from './views/LoginView'
import { GalleryView } from './views/GalleryView'
import { ChatView } from './views/ChatView'
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

  const handleNewSession = () => {
    socketRef.current?.send({ type: 'new_session' })
  }

  const handleSelectSession = (id: string) => {
    const session = sessions.find(s => s.id === id)
    setActiveSessionName(session?.name || 'Session')
    socketRef.current?.send({ type: 'resume_session', sessionId: id })
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
          {view.name === 'chat' && (
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
          sessions={sessions}
          onNewSession={handleNewSession}
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
    </div>
  )
}

export default App
