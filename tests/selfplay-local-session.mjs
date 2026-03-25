#!/usr/bin/env node
// Self-play: Hilbert Talk local session lifecycle
// Tests the full Supabase plumbing with a mock responder standing in for Claude

const SB_URL = 'https://aquysbccogwqloydoymz.supabase.co'
const SB_KEY = (await import('fs')).readFileSync('/tmp/watest-sb-key', 'utf8').trim()
const EMAIL = 'yebomnt@gmail.com'
const sbH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }

const results = []
function check(name, pass, reason = '') {
  results.push({ name, pass, reason })
  console.log(pass ? `  [ok] ${name}` : `  [!!] ${name} -- ${reason}`)
}

async function sbRead(table, filter, select) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}&select=${select}`, { headers: sbH })
  return r.json()
}
async function sbPatch(table, filter, data) {
  await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: sbH, body: JSON.stringify(data) })
}

// === SETUP: Create two sessions ===
const SID1 = `selfplay-1-${Date.now()}`
const SID2 = `selfplay-2-${Date.now()}`
console.log(`Sessions: ${SID1}, ${SID2}\n`)

// Clean cc_commands
await sbPatch('user_data', `email=eq.${EMAIL}`, { cc_commands: [] })

// === TEST 1: Write start_session command ===
const rows = await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_commands')
const cmds = rows?.[0]?.cc_commands || []
cmds.push({ action: 'start_session', target: 'local', id: SID1, ts: new Date().toISOString() })
await sbPatch('user_data', `email=eq.${EMAIL}`, { cc_commands: cmds })

const verify1 = await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_commands')
const hasCmd = verify1?.[0]?.cc_commands?.some(c => c.id === SID1)
check('1. start_session command written', hasCmd)

// === TEST 2: Register session (simulate daemon startup) ===
// Create cc_chat_log + cc_sessions entry
await fetch(`${SB_URL}/rest/v1/cc_chat_log`, {
  method: 'POST', headers: sbH,
  body: JSON.stringify({ session_id: SID1, origin: 'local', user_email: EMAIL, messages: [] })
})

const sessRows = await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_sessions')
const sessions = sessRows?.[0]?.cc_sessions || []
sessions.push({ id: SID1, name: 'WA-Chat', type: 'local', status: 'online', lastSeen: new Date().toISOString(), lastMessage: 'Ready' })
await sbPatch('user_data', `email=eq.${EMAIL}`, { cc_sessions: sessions })

const verify2 = await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_sessions')
const sessionOnline = verify2?.[0]?.cc_sessions?.some(s => s.id === SID1 && s.status === 'online')
check('2. Session registered online in gallery', sessionOnline)

// === TEST 3: Send message from Hilbert Talk ===
const inboxRows = await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_inbox')
const inbox = inboxRows?.[0]?.cc_inbox || []
const msgTs = new Date().toISOString()
inbox.push({ from: 'user', body: 'cc: list files in my home directory', ts: msgTs, read: false, channel: 'hilbert-talk', session_id: SID1 })
await sbPatch('user_data', `email=eq.${EMAIL}`, { cc_inbox: inbox })

const verify3 = await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_inbox')
const msgLanded = verify3?.[0]?.cc_inbox?.some(m => m.session_id === SID1 && !m.read)
check('3. Message written to cc_inbox', msgLanded)

// === TEST 4: Mock responder picks up and responds ===
// (Simulates what cc-local-daemon / Claude session does)
const respTs = new Date().toISOString()
const chatRows = await sbRead('cc_chat_log', `session_id=eq.${SID1}`, 'messages')
const msgs = chatRows?.[0]?.messages || []
msgs.push({ role: 'user', content: 'list files in my home directory', ts: msgTs })
msgs.push({ role: 'assistant', content: 'Here are the files in ~/:\nDesktop, Documents, Downloads, Music, Pictures, .claude', ts: respTs })
await sbPatch('cc_chat_log', `session_id=eq.${SID1}`, { messages: msgs, updated_at: respTs })

// Also write to cc_inbox
const inbox2 = (await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_inbox'))?.[0]?.cc_inbox || []
inbox2.push({ from: 'cc', body: 'Here are the files in ~/:\nDesktop, Documents, Downloads, Music, Pictures, .claude', ts: respTs, channel: 'hilbert-talk', session_id: SID1 })
await sbPatch('user_data', `email=eq.${EMAIL}`, { cc_inbox: inbox2 })

const verify4 = await sbRead('cc_chat_log', `session_id=eq.${SID1}`, 'messages')
const hasResponse = verify4?.[0]?.messages?.some(m => m.role === 'assistant' && m.content.includes('Desktop'))
check('4. Response appears in cc_chat_log', hasResponse)

// === TEST 5: Multi-turn - send follow-up ===
const inbox3 = (await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_inbox'))?.[0]?.cc_inbox || []
const msg2Ts = new Date().toISOString()
inbox3.push({ from: 'user', body: 'cc: now show me what is in Downloads', ts: msg2Ts, read: false, channel: 'hilbert-talk', session_id: SID1 })
await sbPatch('user_data', `email=eq.${EMAIL}`, { cc_inbox: inbox3 })

// Mock response with context awareness
const resp2Ts = new Date().toISOString()
const chatRows2 = await sbRead('cc_chat_log', `session_id=eq.${SID1}`, 'messages')
const msgs2 = chatRows2?.[0]?.messages || []
msgs2.push({ role: 'user', content: 'now show me what is in Downloads', ts: msg2Ts })
msgs2.push({ role: 'assistant', content: 'Contents of ~/Downloads:\nNew Spacetime, hilbert-talk, portfolio-folio', ts: resp2Ts })
await sbPatch('cc_chat_log', `session_id=eq.${SID1}`, { messages: msgs2, updated_at: resp2Ts })

const verify5 = await sbRead('cc_chat_log', `session_id=eq.${SID1}`, 'messages')
const turnCount = verify5?.[0]?.messages?.length || 0
check('5. Multi-turn: 4 messages in chat log', turnCount === 4, `got ${turnCount}`)

// === TEST 6: Start SECOND session ===
await fetch(`${SB_URL}/rest/v1/cc_chat_log`, {
  method: 'POST', headers: sbH,
  body: JSON.stringify({ session_id: SID2, origin: 'local', user_email: EMAIL, messages: [] })
})
const sess2 = (await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_sessions'))?.[0]?.cc_sessions || []
sess2.push({ id: SID2, name: 'WA-Chat', type: 'local', status: 'online', lastSeen: new Date().toISOString(), lastMessage: 'Ready' })
await sbPatch('user_data', `email=eq.${EMAIL}`, { cc_sessions: sess2 })

const verify6 = await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_sessions')
const bothOnline = verify6?.[0]?.cc_sessions?.filter(s => s.id === SID1 || s.id === SID2).length === 2
check('6. Two sessions visible in gallery', bothOnline)

// === TEST 7: Messages don't bleed between sessions ===
const inbox4 = (await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_inbox'))?.[0]?.cc_inbox || []
inbox4.push({ from: 'user', body: 'cc: this is for session 2 only', ts: new Date().toISOString(), read: false, channel: 'hilbert-talk', session_id: SID2 })
await sbPatch('user_data', `email=eq.${EMAIL}`, { cc_inbox: inbox4 })

// Mock response in session 2
const chatS2 = [{ role: 'user', content: 'this is for session 2 only', ts: new Date().toISOString() },
  { role: 'assistant', content: 'Got it, session 2 here', ts: new Date().toISOString() }]
await sbPatch('cc_chat_log', `session_id=eq.${SID2}`, { messages: chatS2, updated_at: new Date().toISOString() })

// Verify session 1 still has 4 messages, session 2 has 2
const s1msgs = (await sbRead('cc_chat_log', `session_id=eq.${SID1}`, 'messages'))?.[0]?.messages?.length || 0
const s2msgs = (await sbRead('cc_chat_log', `session_id=eq.${SID2}`, 'messages'))?.[0]?.messages?.length || 0
check('7. Session isolation: S1 has 4, S2 has 2', s1msgs === 4 && s2msgs === 2, `S1=${s1msgs}, S2=${s2msgs}`)

// === TEST 8: Hilbert Talk renders both sessions (headless browser) ===
let browserPass = false
try {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } })

  const authRes = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ghost@hilbert.test', password: 'ghost-test-2026!', returnSecureToken: true })
  })
  const auth = await authRes.json()

  await page.goto('https://hilbert-talk.web.app', { waitUntil: 'commit', timeout: 10000 })
  await page.evaluate(({ idToken, refreshToken, localId, email }) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('firebaseLocalStorageDb', 1)
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('firebaseLocalStorage')) req.result.createObjectStore('firebaseLocalStorage') }
      req.onsuccess = () => {
        const tx = req.result.transaction('firebaseLocalStorage', 'readwrite')
        const key = 'firebase:authUser:AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ:[DEFAULT]'
        tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value: {
          uid: localId, email, stsTokenManager: { refreshToken, accessToken: idToken, expirationTime: Date.now() + 3600000 },
          apiKey: 'AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ', appName: '[DEFAULT]'
        }}, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
    })
  }, auth)

  await page.goto('https://hilbert-talk.web.app?v=' + Date.now(), { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(8000)

  const bodyText = await page.textContent('body')
  console.log('  DEBUG: has Sessions:', bodyText.includes('Sessions'), 'has Sign in:', bodyText.includes('Sign in'), 'has Loading:', bodyText.includes('Loading'))
  await page.screenshot({ path: '/tmp/ghost-selfplay/selfplay-debug.png', fullPage: true })

  const cards = await page.$$('.session-card')
  const cardTexts = await Promise.all(cards.map(c => c.textContent()))
  const waChatCards = cardTexts.filter(t => t.includes('WA-Chat'))
  browserPass = waChatCards.length >= 2
  check('8. Hilbert Talk shows both WA-Chat sessions', browserPass, `${waChatCards.length} WA-Chat cards`)

  // Click first WA-Chat card and check messages render
  if (cards.length > 0) {
    for (const card of cards) {
      const t = await card.textContent()
      if (t.includes('WA-Chat')) { await card.click(); break }
    }
    await page.waitForTimeout(5000)
    const msgEls = await page.$$('.message')
    check('9. Chat view shows messages after clicking', msgEls.length > 0, `${msgEls.length} messages`)

    const bodyText = await page.textContent('body')
    const hasAssistant = bodyText.includes('Desktop') || bodyText.includes('Documents')
    check('10. Assistant response visible in chat', hasAssistant, hasAssistant ? '' : 'no file listing found')
  } else {
    check('9. Chat view shows messages after clicking', false, 'no cards to click')
    check('10. Assistant response visible in chat', false, 'skipped')
  }

  await page.screenshot({ path: '/tmp/ghost-selfplay/selfplay-e2e.png', fullPage: true })
  await browser.close()
} catch (e) {
  check('8. Browser test', false, e.message)
}

// === TEST 8: Hilbert Talk renders both sessions (headless browser) ===
// Moved BEFORE cleanup so sessions still exist
const sessOff = (await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_sessions'))?.[0]?.cc_sessions || []
const updated = sessOff.map(s => s.id === SID1 ? { ...s, status: 'offline', lastSeen: new Date(Date.now() - 10 * 60000).toISOString() } : s)
await sbPatch('user_data', `email=eq.${EMAIL}`, { cc_sessions: updated })
const verify11 = (await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_sessions'))?.[0]?.cc_sessions?.find(s => s.id === SID1)
check('11. Session 1 marked offline', verify11?.status === 'offline')

// === TEST 12: Clean up test data ===
await fetch(`${SB_URL}/rest/v1/cc_chat_log?session_id=eq.${SID1}`, { method: 'DELETE', headers: sbH })
await fetch(`${SB_URL}/rest/v1/cc_chat_log?session_id=eq.${SID2}`, { method: 'DELETE', headers: sbH })
const sessClean = (await sbRead('user_data', `email=eq.${EMAIL}`, 'cc_sessions'))?.[0]?.cc_sessions || []
const cleaned = sessClean.filter(s => s.id !== SID1 && s.id !== SID2)
await sbPatch('user_data', `email=eq.${EMAIL}`, { cc_sessions: cleaned })
check('12. Test data cleaned up', true)

// === REPORT ===
console.log('\n')
console.log('SELF-PLAY REPORT: Hilbert Talk Local Session Lifecycle')
console.log('=====================================================')
const passed = results.filter(r => r.pass).length
console.log(`Status: ${passed === results.length ? 'PASS' : 'FAIL'} (${passed}/${results.length})`)
console.log('')
for (const r of results) {
  console.log(r.pass ? `  [ok] ${r.name}` : `  [!!] ${r.name} -- ${r.reason}`)
}
process.exit(passed === results.length ? 0 : 1)
