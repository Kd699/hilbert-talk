export type SessionOrigin = 'local' | 'vps' | 'cloud'

export interface SessionMeta {
  id: string
  name: string
  createdAt: number
  lastActiveAt: number
  status: 'active' | 'resumable'
  origin?: SessionOrigin
  pending?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  toolCalls?: ToolCallInfo[]
  isStreaming?: boolean
}

export interface ToolCallInfo {
  id: string
  name: string
  input: string
  output?: string
  isRunning?: boolean
}

// WS messages client -> server
export type ClientMessage =
  | { type: 'list_sessions' }
  | { type: 'new_session' }
  | { type: 'resume_session'; sessionId: string }
  | { type: 'send_message'; text: string }
  | { type: 'stop_session' }
  | { type: 'ping' }

// WS messages server -> client
export type ServerMessage =
  | { type: 'sessions_list'; sessions: SessionMeta[] }
  | { type: 'session_created'; sessionId: string; name: string }
  | { type: 'session_resumed'; sessionId: string; history?: Array<{role: string, content: string, timestamp?: number}> }
  | { type: 'session_stopped'; sessionId: string }
  | { type: 'stream_event'; event: StreamEvent }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong' }

// Claude stream-json events (subset we care about)
export type StreamEvent =
  | { type: 'system'; subtype: 'init'; session_id: string }
  | { type: 'assistant'; message: AssistantMessage }
  | { type: 'stream_event'; event: ContentEvent }
  | { type: 'result'; subtype: 'success' | 'error'; result?: string }
  | { type: 'process_exit'; code: number | null; signal: string | null; sessionId: string }
  | { type: 'error'; message: string; sessionId?: string }
  | { type: 'raw'; text: string }
  | { type: 'stderr'; text: string }

export interface AssistantMessage {
  content: ContentBlock[]
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  content?: string
}

export interface ContentEvent {
  type: string
  index?: number
  content_block?: ContentBlock
  delta?: { type: string; text?: string; partial_json?: string }
}

export type View =
  | { name: 'login' }
  | { name: 'gallery' }
  | { name: 'chat'; sessionId: string }
  | { name: 'local-chat'; sessionId: string }
