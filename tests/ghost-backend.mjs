#!/usr/bin/env node
// Hilbert Talk - Backend Ghost Test
// Tests WS protocol: connect, list sessions, create session, send message, get response, resume with history
// Run: node tests/ghost-backend.mjs [wss://url]

import WebSocket from 'ws';

const WS_URL = process.argv[2] || process.env.GHOST_URL || 'wss://localhost:3001';
const TIMEOUT = 15000;
const results = [];

function check(name, pass, reason) {
  results.push({ name, pass, reason });
  console.log(pass ? `  [ok] ${name}` : `  [!!] ${name} -- ${reason}`);
}

function report() {
  const passed = results.filter(r => r.pass).length;
  const status = passed === results.length ? 'PASS' : 'FAIL';
  console.log(`\nGHOST BACKEND: ${status} (${passed}/${results.length})`);
  process.exit(status === 'PASS' ? 0 : 1);
}

function waitFor(ws, type, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

function collectUntil(ws, stopType, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const events = [];
    const timer = setTimeout(() => resolve(events), timeout);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      events.push(msg);
      if (msg.type === 'stream_event' && msg.event?.type === stopType) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(events);
      }
    };
    ws.on('message', handler);
  });
}

try {
  // Test 1: Connect
  const ws = new WebSocket(WS_URL, { rejectUnauthorized: false });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connect timeout')), 5000);
  });
  check('WS connect', true);

  // Test 2: List sessions
  ws.send(JSON.stringify({ type: 'list_sessions' }));
  const listMsg = await waitFor(ws, 'sessions_list');
  check('list_sessions', Array.isArray(listMsg.sessions), 'sessions not an array');
  const sessionCount = listMsg.sessions.length;
  check(`found ${sessionCount} sessions`, sessionCount >= 0, 'negative count');

  // Test 3: Create new session
  ws.send(JSON.stringify({ type: 'new_session' }));
  const createMsg = await waitFor(ws, 'session_created');
  const sid = createMsg.sessionId;
  check('new_session', !!sid && sid.length > 10, 'no sessionId returned');

  // Test 4: Send message and get streaming response
  ws.send(JSON.stringify({ type: 'send_message', text: 'my name is Ziggy. remember that.' }));
  const events = await collectUntil(ws, 'result', 30000);
  const textDeltas = events
    .filter(e => e.type === 'stream_event' && e.event?.type === 'content_block_delta' && e.event?.delta?.text)
    .map(e => e.event.delta.text);
  const fullResponse = textDeltas.join('');
  check('send_message response', fullResponse.length > 0, 'empty response');
  check('response text', true, `"${fullResponse.substring(0, 50)}"`);

  // Test 5: List sessions again -- new session should appear
  ws.send(JSON.stringify({ type: 'list_sessions' }));
  const listMsg2 = await waitFor(ws, 'sessions_list');
  const newCount = listMsg2.sessions.length;
  const hasNewSession = listMsg2.sessions.some(s => s.id === sid);
  check('session persisted', hasNewSession, `session ${sid.substring(0,8)} not in list`);

  // Test 6: Resume session -- should get history
  ws.send(JSON.stringify({ type: 'resume_session', sessionId: sid }));
  const resumeMsg = await waitFor(ws, 'session_resumed');
  const history = resumeMsg.history || [];
  check('resume has history', history.length >= 2, `expected >=2 messages, got ${history.length}`);
  const hasUser = history.some(m => m.role === 'user');
  const hasAssistant = history.some(m => m.role === 'assistant');
  check('history has user msg', hasUser, 'no user message in history');
  check('history has assistant msg', hasAssistant, 'no assistant message in history');

  // Test 7: Send second message -- verify Claude remembers context
  await new Promise(r => setTimeout(r, 2000));
  ws.send(JSON.stringify({ type: 'send_message', text: 'what is my name?' }));
  const events2 = await collectUntil(ws, 'result', 30000);
  const text2 = events2
    .filter(e => e.type === 'stream_event' && e.event?.type === 'content_block_delta' && e.event?.delta?.text)
    .map(e => e.event.delta.text)
    .join('');
  check('multi-turn response', text2.length > 0, 'empty second response');
  const remembers = text2.toLowerCase().includes('ziggy');
  check('claude remembers context', remembers, `response "${text2.substring(0, 60)}" doesn't mention Ziggy`);

  // Test 8: Resume history includes BOTH exchanges
  ws.send(JSON.stringify({ type: 'resume_session', sessionId: sid }));
  const resumeMsg2 = await waitFor(ws, 'session_resumed');
  const history2 = resumeMsg2.history || [];
  check('full history after 2 turns', history2.length >= 4, `expected >=4 messages, got ${history2.length}`);

  ws.close();
} catch (err) {
  check('fatal', false, err.message);
}

report();
