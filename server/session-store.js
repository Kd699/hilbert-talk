const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = '/home/claude/hilbert-sessions';
const SESSIONS_FILE = path.join(SESSIONS_DIR, 'sessions.json');

function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function readAll() {
  ensureDir();
  if (!fs.existsSync(SESSIONS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(data) {
  ensureDir();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

function listSessions() {
  const all = readAll();
  return Object.entries(all)
    .map(([id, meta]) => ({ id, ...meta }))
    .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
}

function createSession(id, name) {
  const all = readAll();
  all[id] = {
    name: name || 'New Session',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    status: 'active',
  };
  writeAll(all);
  return all[id];
}

function updateSession(id, updates) {
  const all = readAll();
  if (!all[id]) return null;
  Object.assign(all[id], updates, { lastActiveAt: Date.now() });
  writeAll(all);
  return all[id];
}

function getSession(id) {
  const all = readAll();
  return all[id] ? { id, ...all[id] } : null;
}

function deleteSession(id) {
  const all = readAll();
  delete all[id];
  writeAll(all);
}

module.exports = { listSessions, createSession, updateSession, getSession, deleteSession };
