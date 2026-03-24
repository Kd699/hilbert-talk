import type { ClientMessage, ServerMessage } from './types'

type MessageHandler = (msg: ServerMessage) => void
type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected') => void

const VPS_HOST = 'dense-voluntary-satisfaction-pty.trycloudflare.com'

export class HilbertSocket {
  private ws: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private getToken: () => Promise<string | null>
  private onMessage: MessageHandler
  private onStatus: StatusHandler
  private shouldReconnect = true
  private pingInterval: number | null = null

  constructor(
    getToken: () => Promise<string | null>,
    onMessage: MessageHandler,
    onStatus: StatusHandler,
  ) {
    this.getToken = getToken
    this.onMessage = onMessage
    this.onStatus = onStatus

    // Reconnect when tab becomes visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.isConnected()) {
        this.connect()
      }
    })
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return

    this.onStatus('connecting')
    this.shouldReconnect = true

    const token = await this.getToken()
    if (!token) {
      this.onStatus('disconnected')
      return
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'wss:'
    const wsUrl = `${protocol}//${VPS_HOST}/ws?token=${encodeURIComponent(token)}`

    try {
      this.ws = new WebSocket(wsUrl)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.onStatus('connected')
      this.reconnectDelay = 1000
      this.startPing()
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage
        this.onMessage(msg)
      } catch {
        // ignore invalid JSON
      }
    }

    this.ws.onclose = () => {
      this.onStatus('disconnected')
      this.stopPing()
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      // onclose will fire after this
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.stopPing()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
  }

  private startPing(): void {
    this.stopPing()
    this.pingInterval = window.setInterval(() => {
      this.send({ type: 'ping' })
    }, 30000)
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }
}
