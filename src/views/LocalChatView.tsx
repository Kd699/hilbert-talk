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
  image?: string // base64 or URL
}

interface LocalChatViewProps {
  sessionId: string
  onHandoverToVPS?: (history: Message[]) => void
}

export function LocalChatView({ sessionId, onHandoverToVPS }: LocalChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastMsgCountRef = useRef(0)

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/cc_chat_log?session_id=eq.${sessionId}&select=messages`,
        { headers: sbHeaders },
      )
      const rows = await res.json()
      const msgs: Message[] = rows?.[0]?.messages || []

      // If we got a new assistant message, stop waiting
      if (waiting && msgs.length > lastMsgCountRef.current) {
        const newMsgs = msgs.slice(lastMsgCountRef.current)
        if (newMsgs.some(m => m.role === 'assistant')) {
          setWaiting(false)
        }
      }
      lastMsgCountRef.current = msgs.length

      setMessages(prev => {
        // Merge: keep optimistic local messages, replace with server when available
        const serverContent = new Set(msgs.map(m => m.content))
        const localOnly = prev.filter(m => m.ts === 'local' && !serverContent.has(m.content))
        return [...msgs, ...localOnly]
      })
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [sessionId, waiting])

  useEffect(() => {
    fetchMessages()
    const interval = setInterval(fetchMessages, waiting ? 2000 : 3000)
    return () => clearInterval(interval)
  }, [fetchMessages, waiting])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, waiting])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setInput('')

    // Optimistic: show message immediately
    setMessages(prev => [...prev, { role: 'user', content: text, ts: 'local' }])
    setWaiting(true)

    try {
      const inboxRes = await fetch(
        `${SB_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(EMAIL)}&select=cc_inbox`,
        { headers: sbHeaders },
      )
      const rows = await inboxRes.json()
      const inbox = rows?.[0]?.cc_inbox || []
      inbox.push({
        from: 'user',
        body: `cc: ${text}`,
        ts: new Date().toISOString(),
        read: false,
        channel: 'hilbert-talk',
        session_id: sessionId,
      })
      await fetch(`${SB_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(EMAIL)}`, {
        method: 'PATCH',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ cc_inbox: inbox }),
      })
    } catch (e) {
      console.error('[LocalChat] send failed:', e)
      setWaiting(false)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const sendImage = async (file: File) => {
    setSending(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1]
      const mediaType = file.type || 'image/jpeg'

      // Optimistic: show image immediately
      setMessages(prev => [...prev, { role: 'user', content: '[image]', ts: 'local', image: reader.result as string }])
      setWaiting(true)

      try {
        const inboxRes = await fetch(
          `${SB_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(EMAIL)}&select=cc_inbox`,
          { headers: sbHeaders },
        )
        const rows = await inboxRes.json()
        const inbox = rows?.[0]?.cc_inbox || []
        inbox.push({
          from: 'user',
          body: 'cc: [image]',
          image_base64: base64,
          media_type: mediaType,
          ts: new Date().toISOString(),
          read: false,
          channel: 'hilbert-talk',
          session_id: sessionId,
        })
        await fetch(`${SB_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(EMAIL)}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ cc_inbox: inbox }),
        })
      } catch (e) {
        console.error('[LocalChat] image send failed:', e)
        setWaiting(false)
      } finally {
        setSending(false)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const formatTime = (ts: string) => {
    if (ts === 'local') return 'now'
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="chat-view">
      <div className="local-chat-header">
        <span className="origin-badge origin-local">Mac</span>
        <span className="local-chat-label">Local session</span>
        {onHandoverToVPS && messages.length > 0 && (
          <button className="handover-btn" onClick={() => onHandoverToVPS(messages)}>
            Continue on VPS
          </button>
        )}
      </div>

      <div className="messages-container">
        {loading ? (
          <div className="gallery-loading">Loading chat...</div>
        ) : messages.length === 0 && !waiting ? (
          <div className="empty-state">
            <div className="empty-state-icon">H</div>
            <div className="empty-state-title">Send a message</div>
            <div className="empty-state-hint">
              Your messages go directly to Claude Code on your Mac.
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role}`}>
                <div className="message-label">
                  {msg.role === 'user' ? 'you' : 'claude'}
                </div>
                <div className="message-bubble">
                  {msg.image && <img src={msg.image} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: msg.content !== '[image]' ? 8 : 0 }} />}
                  {msg.content !== '[image]' && (msg.role === 'assistant' ? renderContent(msg.content) : msg.content.replace(/^cc:\s*/i, ''))}
                </div>
                <div className="message-time">{formatTime(msg.ts)}</div>
              </div>
            ))}

            {waiting && (
              <div className="loading-message">
                <div className="message-label">claude</div>
                <div className="loading-bubble">
                  <div className="loading-dots">
                    <div className="loading-dot" />
                    <div className="loading-dot" />
                    <div className="loading-dot" />
                  </div>
                  <span className="loading-text">thinking...</span>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <div className="input-wrapper">
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) sendImage(e.target.files[0]); e.target.value = '' }} />
          <button className="image-button" onClick={() => fileInputRef.current?.click()} disabled={sending} title="Send image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <textarea
            ref={inputRef}
            className="input-field"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            disabled={sending}
          />
          <button
            className="send-button"
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            title="Send message"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div className="input-hint">Enter to send / Shift+Enter for new line</div>
      </div>
    </div>
  )
}
