const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const readline = require('readline');

const CLAUDE_BIN = '/home/claude/.local/bin/claude';
const MAX_CONCURRENT = 3;

class ClaudePool {
  constructor(sessionStore) {
    this.sessionStore = sessionStore;
    this.active = new Set(); // sessionIds currently processing
  }

  activeCount() {
    return this.active.size;
  }

  isActive(sessionId) {
    return this.active.has(sessionId);
  }

  // Each message spawns a new claude -p process with --resume
  async sendMessage(sessionId, text, onEvent) {
    if (this.active.has(sessionId)) {
      throw new Error('Session is already processing a message');
    }

    if (this.active.size >= MAX_CONCURRENT) {
      throw new Error(`Max concurrent sessions (${MAX_CONCURRENT}) reached`);
    }

    this.active.add(sessionId);

    // Check if session has been used before
    const session = this.sessionStore.getSession(sessionId);
    const isFirstMessage = session && session.name === 'New Session' && !session.messageCount;

    const args = [
      '-p', text,
      '--verbose',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      '--model', 'sonnet',
    ];

    if (isFirstMessage) {
      args.push('--session-id', sessionId);
    } else {
      args.push('--resume', sessionId);
    }

    const proc = spawn(CLAUDE_BIN, args, {
      cwd: '/home/claude',
      env: { ...process.env, HOME: '/home/claude' },
      stdio: ['pipe', 'pipe', 'pipe'],
      uid: 1000,
      gid: 1000,
    });

    const rl = readline.createInterface({ input: proc.stdout });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        // Claude emits { type: 'stream_event', event: { type: 'content_block_delta', ... } }
        // The server wraps in { type: 'stream_event', event: <this> }
        // So unwrap here: send the inner event object directly
        if (event.type === 'stream_event' && event.event) {
          onEvent(event.event);
        } else {
          onEvent(event);
        }
      } catch {
        onEvent({ type: 'raw', text: line });
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        onEvent({ type: 'stderr', text });
      }
    });

    proc.on('exit', (code, signal) => {
      this.active.delete(sessionId);
      const s = this.sessionStore.getSession(sessionId);
      this.sessionStore.updateSession(sessionId, {
        lastActiveAt: Date.now(),
        messageCount: (s?.messageCount || 0) + 1,
      });
      onEvent({
        type: 'result',
        subtype: code === 0 ? 'success' : 'error',
        code,
        signal,
        sessionId,
      });
    });

    proc.on('error', (err) => {
      this.active.delete(sessionId);
      onEvent({
        type: 'error',
        message: `Process error: ${err.message}`,
        sessionId,
      });
    });

    return sessionId;
  }

  createSession() {
    const sessionId = randomUUID();
    this.sessionStore.createSession(sessionId, 'New Session');
    return sessionId;
  }
}

module.exports = { ClaudePool };
