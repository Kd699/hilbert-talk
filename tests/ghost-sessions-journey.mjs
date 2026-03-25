#!/usr/bin/env node
// Ghost Journey: "Session chooser and origin badges"
// Extracted from chat spec. Navigates like a real user, not a test robot.
import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';

const APP_URL = process.env.GHOST_URL || 'https://hilbert-talk.web.app';
const DIR = '/tmp/ghost-sessions';
mkdirSync(DIR, { recursive: true });

const API_KEY = 'AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ';
const GHOST_EMAIL = 'ghost@hilbert.test';
const GHOST_PASS = 'ghost-test-2026!';

// Supabase for data verification
const SB_URL = 'https://aquysbccogwqloydoymz.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxdXlzYmNjb2d3cWxveWRveW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NzY1NzYsImV4cCI6MjA4NTU1MjU3Nn0.IV08zf40TK-NPOB_OyTRPcCdRA9AxkNzhKV17JL3jAU';
const SB_EMAIL = 'yebomnt@gmail.com';
const sbH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'x-user-email': SB_EMAIL };

const assertions = [];
const weights = { P0: 3, P1: 2, P2: 1 };

function assert(name, pass, reason = '', priority = 'P0') {
  assertions.push({ name, pass, reason, priority });
  console.log(pass ? `  [ok] ${name}` : `  [!!] ${name} -- ${reason}`);
}

let step = 0;
async function screenshot(page, label) {
  step++;
  const path = `${DIR}/${String(step).padStart(2, '0')}-${label}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

// Network + console error capture
const networkErrors = [];
const consoleErrors = [];

let browser;
try {
  // === AUTH ===
  const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: GHOST_EMAIL, password: GHOST_PASS, returnSecureToken: true }),
  });
  const authData = await authRes.json();
  if (!authData.idToken) {
    assert('Auth', false, `Firebase auth failed: ${authData.error?.message}`, 'P0');
    throw new Error('Auth failed');
  }

  // === LAUNCH BROWSER ===
  browser = await chromium.launch({ headless: true, args: ['--disable-web-security'] });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const cdpSession = await context.newCDPSession(await context.newPage());
  await cdpSession.send('Network.setCacheDisabled', { cacheDisabled: true });
  const page = context.pages()[0];

  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', res => { if (res.status() >= 400 && !res.url().includes('favicon')) networkErrors.push(`${res.status()} ${res.url()}`); });

  // Inject Firebase auth
  await page.goto(APP_URL, { waitUntil: 'commit', timeout: 10000 });
  await page.evaluate(({ idToken, refreshToken, localId, email }) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('firebaseLocalStorageDb', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) db.createObjectStore('firebaseLocalStorage');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('firebaseLocalStorage', 'readwrite');
        const store = tx.objectStore('firebaseLocalStorage');
        const key = 'firebase:authUser:AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ:[DEFAULT]';
        store.put({ fbase_key: key, value: {
          uid: localId, email, emailVerified: false, isAnonymous: false,
          stsTokenManager: { refreshToken, accessToken: idToken, expirationTime: Date.now() + 3600000 },
          createdAt: String(Date.now()), lastLoginAt: String(Date.now()),
          apiKey: 'AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ', appName: '[DEFAULT]',
        }}, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, authData);

  // Navigate fresh
  await page.goto(APP_URL + '?v=' + Date.now(), { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);
  await screenshot(page, 'gallery-loaded');

  // === ASSERTION 1: Gallery shows sessions with origin badges ===
  const bodyText = await page.textContent('body');
  const hasGallery = bodyText.includes('Sessions');
  assert('Gallery visible after auth', hasGallery, hasGallery ? '' : 'Gallery not found -- still on login?', 'P0');

  const badges = await page.$$('.origin-badge');
  assert('Origin badges visible on session cards', badges.length > 0, badges.length > 0 ? `${badges.length} badge(s)` : 'No .origin-badge elements found', 'P0');

  // Check badge text is Mac/VPS/Cloud (data-grounded, not just existence)
  if (badges.length > 0) {
    const badgeTexts = await Promise.all(badges.map(b => b.textContent()));
    const validBadges = badgeTexts.filter(t => ['Mac', 'VPS', 'Cloud'].includes(t.trim()));
    assert('Badge text is Mac, VPS, or Cloud', validBadges.length === badges.length,
      `Got: ${badgeTexts.map(t => `"${t.trim()}"`).join(', ')}`, 'P1');
  }

  // === ASSERTION 2: Tap "+ New Session" opens chooser ===
  await screenshot(page, 'before-new-session');
  const newSessionBtn = await page.$('.new-session-btn');
  assert('+ New Session button exists', !!newSessionBtn, newSessionBtn ? '' : 'Button not found', 'P0');

  if (newSessionBtn) {
    await newSessionBtn.click();
    await page.waitForTimeout(500);
    await screenshot(page, 'chooser-opened');

    const chooser = await page.$('.chooser-modal');
    assert('Chooser modal opens on tap', !!chooser, chooser ? '' : 'No .chooser-modal appeared', 'P0');

    // === ASSERTION 3: Chooser has VPS and Mac options ===
    if (chooser) {
      const chooserText = await chooser.textContent();
      assert('Chooser shows VPS option', chooserText.includes('VPS'), chooserText.includes('VPS') ? '' : `Chooser text: "${chooserText.slice(0, 80)}"`, 'P0');
      assert('Chooser shows Mac option', chooserText.includes('Mac'), chooserText.includes('Mac') ? '' : `Chooser text: "${chooserText.slice(0, 80)}"`, 'P0');
      assert('Chooser shows device descriptions', chooserText.includes('Hetzner') && chooserText.includes('MacBook'),
        '', 'P2');

      // === ASSERTION 4: Tap Mac shows VISIBLE FEEDBACK ===
      // Clear cc_commands first
      await fetch(`${SB_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(SB_EMAIL)}`, {
        method: 'PATCH',
        headers: { ...sbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ cc_commands: [] }),
      });

      const macOption = await page.$('.chooser-option:last-child');
      if (macOption) {
        await macOption.click();
        await page.waitForTimeout(1000);
        await screenshot(page, 'after-mac-click');

        // THE KEY UX ASSERTION: Is there ANY visible feedback?
        const postClickText = await page.textContent('body');
        const chooserGone = !(await page.$('.chooser-modal'));

        // Check for ANY feedback: toast, pending state, spinner, status message
        const hasFeedback =
          postClickText.includes('Sent') ||
          postClickText.includes('Pending') ||
          postClickText.includes('Starting') ||
          postClickText.includes('Queued') ||
          postClickText.includes('waiting') ||
          (await page.$('.pending-session')) !== null ||
          (await page.$('[class*="spinner"]')) !== null ||
          (await page.$('[class*="toast"]')) !== null;

        assert('Visible feedback after tapping Mac', hasFeedback,
          'No feedback shown to user after tapping Mac -- modal just closed silently. User has no idea if anything happened.',
          'P0');

        // === ASSERTION 5: Pending session appears in gallery ===
        const pendingCard = await page.$('.session-card.pending, .session-card[data-pending]');
        const galleryTextAfter = await page.textContent('body');
        const showsPending = galleryTextAfter.includes('Starting') || galleryTextAfter.includes('Pending') || galleryTextAfter.includes('Queued');
        assert('Pending session visible in gallery', showsPending || !!pendingCard,
          'No pending session indicator in gallery after requesting Mac session',
          'P0');

        // Verify command actually wrote to Supabase (data check)
        const cmdRes = await fetch(`${SB_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(SB_EMAIL)}&select=cc_commands`, { headers: sbH });
        const cmdRows = await cmdRes.json();
        const cmds = cmdRows?.[0]?.cc_commands || [];
        const hasCmd = cmds.some(c => c.action === 'start_session' && c.target === 'local');
        assert('start_session command written to Supabase', hasCmd,
          hasCmd ? '' : `cc_commands: ${JSON.stringify(cmds).slice(0, 60)}`, 'P1');

        // Cleanup
        await fetch(`${SB_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(SB_EMAIL)}`, {
          method: 'PATCH',
          headers: { ...sbH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ cc_commands: [] }),
        });
      }

      // === ASSERTION 7: Dismiss chooser by tapping backdrop ===
      // Re-open chooser
      await newSessionBtn.click();
      await page.waitForTimeout(500);
      const backdrop = await page.$('.chooser-backdrop');
      if (backdrop) {
        // Click the backdrop edge (not the modal)
        const box = await backdrop.boundingBox();
        await page.mouse.click(box.x + 10, box.y + 10);
        await page.waitForTimeout(500);
        const chooserAfter = await page.$('.chooser-modal');
        assert('Backdrop tap dismisses chooser', !chooserAfter,
          chooserAfter ? 'Chooser still visible after backdrop tap' : '', 'P1');
        await screenshot(page, 'after-dismiss');
      }
    }
  }

  // === ASSERTION 6: Cards clearly distinguish devices ===
  const cards = await page.$$('.session-card');
  if (cards.length > 0) {
    let allHaveBadge = true;
    for (const card of cards) {
      const badge = await card.$('.origin-badge');
      if (!badge) { allHaveBadge = false; break; }
    }
    assert('Every session card has an origin badge', allHaveBadge,
      allHaveBadge ? '' : 'Some cards missing origin badge', 'P1');
  }

  // Network + console error checks
  const realNetErrors = networkErrors.filter(e => !e.includes('identitytoolkit') && !e.includes('WebSocket'));
  assert('No network errors', realNetErrors.length === 0, realNetErrors.join('; ').slice(0, 100), 'P1');
  const realConsoleErrors = consoleErrors.filter(e => !e.includes('React DevTools') && !e.includes('favicon') && !e.includes('WebSocket'));
  assert('No console errors', realConsoleErrors.length === 0, realConsoleErrors.join('; ').slice(0, 100), 'P1');

  await screenshot(page, 'final');

} catch (err) {
  if (!assertions.some(a => a.name === 'Auth')) {
    assert('Fatal error', false, err.message, 'P0');
  }
} finally {
  if (browser) await browser.close();
}

// === GHOST REPORT ===
console.log('\n');
console.log('GHOST REPORT');
console.log('============');
console.log(`Journey : "Session chooser and origin badges"`);
console.log(`Persona : Mhlengi, logged in, mobile viewport`);
console.log(`URL     : ${APP_URL}`);
console.log('');

const passed = assertions.filter(a => a.pass).length;
const total = assertions.length;
const loss = assertions.reduce((sum, a) => sum + (a.pass ? 0 : weights[a.priority] || 1), 0);
const maxLoss = assertions.reduce((sum, a) => sum + (weights[a.priority] || 1), 0);
const normLoss = maxLoss > 0 ? (loss / maxLoss).toFixed(3) : '0.000';

console.log(`Status  : ${loss === 0 ? 'PASS' : 'FAIL'} (${passed}/${total} checks)`);
console.log(`Loss    : ${normLoss} (${loss}/${maxLoss} weighted)`);
console.log('');

for (const a of assertions) {
  if (a.pass) {
    console.log(`  [ok] [${a.priority}] ${a.name}`);
  } else {
    console.log(`  [!!] [${a.priority}] ${a.name}`);
    console.log(`       -- ${a.reason}`);
  }
}

console.log('');
const failures = assertions.filter(a => !a.pass);
if (failures.length > 0) {
  console.log('UX Failures:');
  failures.forEach((f, i) => {
    console.log(`  ${i + 1}. [${f.priority}] ${f.name}`);
    console.log(`     ${f.reason}`);
  });
}

process.exit(loss === 0 ? 0 : 1);
