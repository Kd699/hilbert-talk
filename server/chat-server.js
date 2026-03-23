const https = require('https');
const http = require('http');
const fs = require('fs');
const url = require('url');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { verifyToken } = require('./auth-middleware');
const { ClaudePool } = require('./claude-pool');
const sessionStore = require('./session-store');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Health check (no auth needed)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Create HTTPS server
let server;
const keyPath = '/home/claude/key.pem';
const certPath = '/home/claude/cert.pem';

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  server = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }, app);
  console.log('[server] Using HTTPS');
} else {
  server = http.createServer(app);
  console.log('[server] Using HTTP (no SSL certs found)');
}

// WebSocket server
const wss = new WebSocketServer({ noServer: true });
const pool = new ClaudePool(sessionStore);

// Track which WS client is viewing which session
const clientSessions = new Map(); // ws -> sessionId

server.on('upgrade', async (request, socket, head) => {
  try {
    const { query } = url.parse(request.url, true);
    const token = query.token;

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const decoded = await verifyToken(token);
    console.log(`[auth] Authenticated: ${decoded.email}`);

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.user = decoded;
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    console.error(`[auth] Failed: ${err.message}`);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  console.log(`[ws] Client connected: ${ws.user.email}`);

  function send(msg) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      send({ type: 'error', message: 'Invalid JSON' });
      return;
    }

    try {
      switch (msg.type) {
        case 'list_sessions': {
          const sessions = sessionStore.listSessions();
          // Annotate with live status
          for (const s of sessions) {
            s.status = pool.isActive(s.id) ? 'active' : 'resumable';
          }
          send({ type: 'sessions_list', sessions });
          break;
        }

        case 'new_session': {
          const onEvent = (event) => send({ type: 'stream_event', event });
          const sessionId = await pool.startSession(null, onEvent);
          clientSessions.set(ws, sessionId);

          const session = sessionStore.getSession(sessionId);
          send({ type: 'session_created', sessionId, name: session?.name || 'New Session' });
          break;
        }

        case 'resume_session': {
          const { sessionId } = msg;
          if (!sessionId) {
            send({ type: 'error', message: 'sessionId required' });
            break;
          }

          const onEvent = (event) => send({ type: 'stream_event', event });

          if (pool.isActive(sessionId)) {
            // Session already running, just attach
            pool.updateEventHandler(sessionId, onEvent);
          } else {
            await pool.startSession(sessionId, onEvent);
          }

          clientSessions.set(ws, sessionId);
          send({ type: 'session_resumed', sessionId });
          break;
        }

        case 'send_message': {
          const sessionId = clientSessions.get(ws);
          if (!sessionId) {
            send({ type: 'error', message: 'No active session. Create or resume one first.' });
            break;
          }

          if (!pool.isActive(sessionId)) {
            send({ type: 'error', message: 'Session process not running. Resume it first.', code: 'SESSION_DEAD' });
            break;
          }

          const { text } = msg;
          if (!text || typeof text !== 'string') {
            send({ type: 'error', message: 'text required' });
            break;
          }

          // Auto-name session from first message
          const session = sessionStore.getSession(sessionId);
          if (session && session.name === 'New Session') {
            const autoName = text.length > 50 ? text.substring(0, 50) + '...' : text;
            sessionStore.updateSession(sessionId, { name: autoName });
          }

          pool.sendMessage(sessionId, text);
          break;
        }

        case 'stop_session': {
          const sessionId = clientSessions.get(ws);
          if (sessionId) {
            pool.stopSession(sessionId);
            clientSessions.delete(ws);
            send({ type: 'session_stopped', sessionId });
          }
          break;
        }

        case 'ping': {
          send({ type: 'pong' });
          break;
        }

        default:
          send({ type: 'error', message: `Unknown message type: ${msg.type}` });
      }
    } catch (err) {
      console.error(`[ws] Error handling ${msg.type}:`, err.message);
      send({ type: 'error', message: err.message });
    }
  });

  ws.on('close', () => {
    console.log(`[ws] Client disconnected: ${ws.user.email}`);
    // Don't stop the session -- it keeps running for resume
    clientSessions.delete(ws);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] Shutting down...');
  pool.stopAll();
  server.close();
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Hilbert Talk v2 running on port ${PORT}`);
});
