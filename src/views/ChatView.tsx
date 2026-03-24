import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChatMessage, ToolCallInfo, StreamEvent, ContentBlock } from '../lib/types'
import { renderContent } from '../lib/markdown'

interface ChatViewProps {
  onSendMessage: (text: string) => void
  onStreamHandler: (handler: (event: StreamEvent) => void) => void
}

interface ParsedBlock {
  type: 'text' | 'tool_use'
  text?: string
  toolName?: string
  toolInput?: string
  toolOutput?: string
  isRunning?: boolean
}

export function ChatView({ onSendMessage, onStreamHandler }: ChatViewProps) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [currentBlocks, setCurrentBlocks] = useState<ParsedBlock[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, currentBlocks, scrollToBottom])

  useEffect(() => {
    if (!isStreaming) {
      inputRef.current?.focus()
    }
  }, [isStreaming])

  // Auto-clear errors
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(t)
    }
  }, [error])

  // Keep handler ref fresh so closure always has latest state
  const handleStreamRef = useRef(handleStreamEvent)
  handleStreamRef.current = handleStreamEvent

  // Register stream event handler -- called directly from WS, no batching
  useEffect(() => {
    onStreamHandler((event: StreamEvent) => handleStreamRef.current(event))
    return () => onStreamHandler(() => {})
  }, [])

  function handleStreamEvent(event: StreamEvent) {
    // Events arrive either wrapped { type: 'stream_event', event: {...} }
    // or unwrapped { type: 'content_block_delta', ... }
    // Normalize: if it's a known inner type, handle directly
    // Unwrap if needed -- events arrive either wrapped or unwrapped
    let ce: any = event
    if (event.type === 'stream_event' && (event as any).event) {
      ce = (event as any).event
    }

    switch (ce.type) {
      case 'system':
        // Session initialized
        break

      case 'message_start': {
        setIsStreaming(true)
        setCurrentBlocks([])
        break
      }

      case 'content_block_start': {
        const block = ce.content_block
        if (block?.type === 'text') {
          setCurrentBlocks(prev => [...prev, { type: 'text', text: '' }])
        } else if (block?.type === 'tool_use') {
          setCurrentBlocks(prev => [...prev, {
            type: 'tool_use',
            toolName: block.name,
            toolInput: '',
            isRunning: true,
          }])
        }
        break
      }

      case 'content_block_delta': {
        const delta = ce.delta
        if (delta?.type === 'text_delta' && delta.text) {
          setCurrentBlocks(prev => {
            if (prev.length === 0) return prev
            const updated = prev.slice()
            const last = { ...updated[updated.length - 1] }
            if (last.type === 'text') {
              last.text = (last.text || '') + delta.text
            }
            updated[updated.length - 1] = last
            return updated
          })
        } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
          setCurrentBlocks(prev => {
            if (prev.length === 0) return prev
            const updated = prev.slice()
            const last = { ...updated[updated.length - 1] }
            if (last.type === 'tool_use') {
              last.toolInput = (last.toolInput || '') + delta.partial_json
            }
            updated[updated.length - 1] = last
            return updated
          })
        }
        break
      }

      case 'content_block_stop': {
        setCurrentBlocks(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.type === 'tool_use') {
            last.isRunning = false
          }
          return updated
        })
        break
      }

      case 'message_stop': {
        setCurrentBlocks(prev => {
          if (prev.length > 0) {
            const textParts = prev.filter(b => b.type === 'text').map(b => b.text || '')
            const tools: ToolCallInfo[] = prev
              .filter(b => b.type === 'tool_use')
              .map((b, i) => ({
                id: `tool-${i}`,
                name: b.toolName || 'unknown',
                input: b.toolInput || '',
                output: b.toolOutput,
              }))

            const msg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: textParts.join(''),
              timestamp: Date.now(),
              toolCalls: tools.length > 0 ? tools : undefined,
            }
            setMessages(m => [...m, msg])
          }
          return []
        })
        setIsStreaming(false)
        break
      }

      case 'assistant': {
        // Complete assistant message (fallback)
        const am = ce.message
        if (am?.content) {
          const textParts = am.content.filter((b: ContentBlock) => b.type === 'text').map((b: ContentBlock) => b.text || '')
          const tools: ToolCallInfo[] = am.content
            .filter((b: ContentBlock) => b.type === 'tool_use')
            .map((b: ContentBlock, i: number) => ({
              id: b.id || `tool-${i}`,
              name: b.name || 'unknown',
              input: typeof b.input === 'object' ? JSON.stringify(b.input) : String(b.input || ''),
            }))

          setMessages(m => [...m, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: textParts.join(''),
            timestamp: Date.now(),
            toolCalls: tools.length > 0 ? tools : undefined,
          }])
          setIsStreaming(false)
          setCurrentBlocks([])
        }
        break
      }

      case 'result':
        setIsStreaming(false)
        setCurrentBlocks([])
        if ((ce as any).subtype === 'error') {
          setError((ce as any).result || 'Session error')
        }
        break

      case 'process_exit':
        setIsStreaming(false)
        setCurrentBlocks([])
        setError('Claude process exited. Session is resumable.')
        break

      case 'error':
        setError((ce as any).message || 'Unknown error')
        setIsStreaming(false)
        break

      case 'raw':
      case 'stderr':
        // Show as system message
        if ((ce as any).text && !(ce as any).text.includes('Downloading')) {
          setMessages(m => [...m, {
            id: crypto.randomUUID(),
            role: 'system',
            content: (ce as any).text,
            timestamp: Date.now(),
          }])
        }
        break
    }
  }

  const sendMessage = () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setMessages(m => [...m, {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }])
    setInput('')
    setIsStreaming(true)
    onSendMessage(text)

    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="chat-view">
      <div className="messages-container">
        {messages.length === 0 && !isStreaming && currentBlocks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">H</div>
            <div className="empty-state-title">New Session</div>
            <div className="empty-state-hint">
              Send a message to start working with Claude Code.
            </div>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <div key={msg.id} className={`message ${msg.role}`}>
                <div className="message-label">
                  {msg.role === 'user' ? 'you' : msg.role === 'system' ? 'system' : 'claude'}
                </div>
                <div className="message-bubble">
                  {msg.toolCalls?.map(tc => (
                    <ToolCallBlock key={tc.id} tool={tc} />
                  ))}
                  {msg.content && (msg.role === 'assistant' ? renderContent(msg.content) : msg.content)}
                </div>
                <div className="message-time">{formatTime(msg.timestamp)}</div>
              </div>
            ))}
          </>
        )}

        {/* Streaming blocks */}
        {currentBlocks.length > 0 && (
          <div className="message assistant">
            <div className="message-label">claude</div>
            <div className="message-bubble">
              {currentBlocks.map((block, i) => {
                if (block.type === 'tool_use') {
                  return (
                    <ToolCallBlock
                      key={`stream-tool-${i}`}
                      tool={{
                        id: `stream-${i}`,
                        name: block.toolName || 'unknown',
                        input: block.toolInput || '',
                        output: block.toolOutput,
                        isRunning: block.isRunning,
                      }}
                    />
                  )
                }
                return (
                  <div key={`stream-text-${i}`} className="streaming-text">
                    {renderContent(block.text || '')}
                    {isStreaming && i === currentBlocks.length - 1 && (
                      <span className="streaming-cursor" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Loading indicator when streaming but no blocks yet */}
        {isStreaming && currentBlocks.length === 0 && (
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

        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <div className="input-wrapper">
          <textarea
            ref={inputRef}
            className="input-field"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            disabled={isStreaming}
          />
          <button
            className="send-button"
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            title="Send message"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div className="input-hint">
          Enter to send / Shift+Enter for new line
        </div>
      </div>

      {error && <div className="error-toast">{error}</div>}
    </div>
  )
}

function ToolCallBlock({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(true)

  let inputDisplay = tool.input
  try {
    const parsed = JSON.parse(tool.input)
    if (parsed.command) inputDisplay = parsed.command
    else if (parsed.file_path) inputDisplay = parsed.file_path
    else if (parsed.pattern) inputDisplay = parsed.pattern
  } catch {
    // use raw input
  }

  return (
    <div className={`tool-call-block ${tool.isRunning ? 'running' : ''}`}>
      <button className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-name">{tool.name}</span>
        <span className="tool-call-chevron">{expanded ? '\u25BC' : '\u25B6'}</span>
      </button>
      {expanded && (
        <div className="tool-call-body">
          <pre className="tool-call-input">{inputDisplay}</pre>
          {tool.output && (
            <pre className="tool-call-output">{tool.output}</pre>
          )}
          {tool.isRunning && (
            <div className="tool-call-running">running...</div>
          )}
        </div>
      )}
    </div>
  )
}
