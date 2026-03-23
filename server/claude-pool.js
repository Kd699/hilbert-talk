const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const readline = require('readline');

const CLAUDE_BIN = '/home/claude/.local/bin/claude';
const MAX_CONCURRENT = 3;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

class ClaudePool {
  constructor(sessionStore) {
    this.sessionStore = sessionStore;
    this.processes = new Map(); // sessionId -> { proc, rl, idleTimer, onEvent }
  }

  activeCount() {
    return this.processes.size;
  }

  isActive(sessionId) {
    return this.processes.has(sessionId);
  }

  async startSession(sessionId, onEvent) {
    if (this.processes.has(sessionId)) {
      // Already running, just update the event handler
      this.processes.get(sessionId).onEvent = onEvent;
      this._resetIdle(sessionId);
      return sessionId;
    }

    if (this.processes.size >= MAX_CONCURRENT) {
      throw new Error(`Max concurrent sessions (${MAX_CONCURRENT}) reached`);
    }

    const isNew = !sessionId;
    if (isNew) sessionId = randomUUID();

    const args = [
      '--print', '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      '--model', 'sonnet',
    ];

    if (isNew) {
      args.push('--session-id', sessionId);
    } else {
      args.push('--resume', sessionId);
    }

    const proc = spawn(CLAUDE_BIN, args, {
      cwd: '/home/claude',
      env: { ...process.env, HOME: '/home/claude' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = readline.createInterface({ input: proc.stdout });

    const entry = { proc, rl, idleTimer: null, onEvent };
    this.processes.set(sessionId, entry);

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        entry.onEvent?.(event);
      } catch (e) {
        // Non-JSON output, forward as raw text
        entry.onEvent?.({ type: 'raw', text: line });
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        entry.onEvent?.({ type: 'stderr', text });
      }
    });

    proc.on('exit', (code, signal) => {
      this.processes.delete(sessionId);
      this.sessionStore.updateSession(sessionId, { status: 'resumable' });
      entry.onEvent?.({
        type: 'process_exit',
        code,
        signal,
        sessionId,
      });
    });

    proc.on('error', (err) => {
      this.processes.delete(sessionId);
      this.sessionStore.updateSession(sessionId, { status: 'resumable' });
      entry.onEvent?.({
        type: 'error',
        message: `Process error: ${err.message}`,
        sessionId,
      });
    });

    this._resetIdle(sessionId);

    if (isNew) {
      this.sessionStore.createSession(sessionId, 'New Session');
    } else {
      this.sessionStore.updateSession(sessionId, { status: 'active' });
    }

    return sessionId;
  }

  sendMessage(sessionId, text) {
    const entry = this.processes.get(sessionId);
    if (!entry) throw new Error('Session not active');

    const msg = JSON.stringify({
      type: 'user_message',
      message: text,
    });
    entry.proc.stdin.write(msg + '\n');
    this._resetIdle(sessionId);

    this.sessionStore.updateSession(sessionId, { lastActiveAt: Date.now() });
  }

  stopSession(sessionId) {
    const entry = this.processes.get(sessionId);
    if (!entry) return;

    clearTimeout(entry.idleTimer);
    entry.proc.kill('SIGTERM');
    this.processes.delete(sessionId);
    this.sessionStore.updateSession(sessionId, { status: 'resumable' });
  }

  updateEventHandler(sessionId, onEvent) {
    const entry = this.processes.get(sessionId);
    if (entry) {
      entry.onEvent = onEvent;
    }
  }

  _resetIdle(sessionId) {
    const entry = this.processes.get(sessionId);
    if (!entry) return;

    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      console.log(`[pool] Idle timeout for session ${sessionId}`);
      this.stopSession(sessionId);
    }, IDLE_TIMEOUT_MS);
  }

  stopAll() {
    for (const [id] of this.processes) {
      this.stopSession(id);
    }
  }
}

module.exports = { ClaudePool };
