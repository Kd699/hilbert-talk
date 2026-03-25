import { useState, useRef, useEffect, useCallback } from 'react'
import { renderContent } from '../lib/markdown'

const SB_URL = 'https://aquysbccogwqloydoymz.supabase.co'
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxdXlzYmNjb2d3cWxveWRveW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NzY1NzYsImV4cCI6MjA4NTU1MjU3Nn0.IV08zf40TK-NPOB_OyTRPcCdRA9AxkNzhKV17JL3jAU'
const EMAIL = 'yebomnt@gmail.com'
const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'x-user-email': EMAIL }

interface Message {
  role: string
  content: string
  ts: string
}

interface LocalChatViewProps {
  sessionId: string
  onBack: () => void
  onHandoverToVPS?: (history: Message[]) => void
}

export function LocalChatView({ sessionId, onBack, onHandoverToVPS }: LocalChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/cc_chat_log?session_id=eq.${sessionId}&select=messages`,
        { headers: sbHeaders },
      )
      const rows = await res.json()
      const msgs = rows?.[0]?.messages || []
      setMessages(msgs)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [sessionId])

  // Initial load + poll every 3s
  useEffect(() => {
    fetchMessages()
    const interval = setInterval(fetchMessages, 3000)
    return () => clearInterval(interval)
  }, [fetchMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const formatTime = (ts: string) => {
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="chat-view">
      <div className="local-chat-header">
        <span className="origin-badge origin-local">Mac</span>
        <span className="local-chat-label">Local session (read-only)</span>
        {onHandoverToVPS && messages.length > 0 && (
          <button className="handover-btn" onClick={() => onHandoverToVPS(messages)}>
            Continue on VPS
          </button>
        )}
      </div>

      <div className="messages-container">
        {loading ? (
          <div className="gallery-loading">Loading chat...</div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">H</div>
            <div className="empty-state-title">Waiting for messages</div>
            <div className="empty-state-hint">
              This session's chat will appear here as it happens on your Mac.
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="message-label">
                {msg.role === 'user' ? 'you' : 'claude'}
              </div>
              <div className="message-bubble">
                {msg.role === 'assistant' ? renderContent(msg.content) : msg.content}
              </div>
              <div className="message-time">{formatTime(msg.ts)}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
