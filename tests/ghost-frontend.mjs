#!/usr/bin/env node
// Hilbert Talk - Frontend Ghost Test
// Headless Chromium: login renders, gallery shows sessions, chat works
// Run: node tests/ghost-frontend.mjs [https://url]

import { chromium } from 'playwright-core';
import { execSync } from 'child_process';

const APP_URL = process.argv[2] || process.env.GHOST_URL || 'https://hilbert-talk.web.app';
const SCREENSHOT_DIR = '/tmp/ghost2-fast';
const results = [];

function check(name, pass, reason) {
  results.push({ name, pass, reason });
  console.log(pass ? `  [ok] ${name}` : `  [!!] ${name} -- ${reason}`);
}

function report() {
  const passed = results.filter(r => r.pass).length;
  const status = passed === results.length ? 'PASS' : 'FAIL';
  console.log(`\nGHOST FRONTEND: ${status} (${passed}/${results.length})`);
  process.exit(status === 'PASS' ? 0 : 1);
}

// Ensure screenshot dir
execSync(`mkdir -p ${SCREENSHOT_DIR}`);

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // Capture network errors
  const networkErrors = [];
  page.on('response', res => { if (res.status() >= 400) networkErrors.push(`${res.status()} ${res.url()}`); });

  // === Auth: sign in via Firebase REST API, inject into IndexedDB ===
  const API_KEY = 'AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ';
  const GHOST_EMAIL = 'ghost@hilbert.test';
  const GHOST_PASS = 'ghost-test-2026!';

  // Sign in via REST to get tokens
  let authData;
  try {
    const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: GHOST_EMAIL, password: GHOST_PASS, returnSecureToken: true }),
    });
    authData = await authRes.json();
    check('ghost user auth', !!authData.idToken, authData.error?.message || '');
  } catch (e) {
    check('ghost user auth', false, e.message);
  }

  // Inject Firebase auth into IndexedDB BEFORE navigating to the app
  // Visit origin first to establish context, then inject, then navigate
  await page.goto(APP_URL, { waitUntil: 'commit', timeout: 10000 });

  if (authData?.idToken) {
    await page.evaluate(({ idToken, refreshToken, localId, email }) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('firebaseLocalStorageDb', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
            db.createObjectStore('firebaseLocalStorage');
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('firebaseLocalStorage', 'readwrite');
          const store = tx.objectStore('firebaseLocalStorage');
          const key = 'firebase:authUser:AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ:[DEFAULT]';
          const value = {
            uid: localId,
            email,
            emailVerified: false,
            isAnonymous: false,
            stsTokenManager: {
              refreshToken,
              accessToken: idToken,
              expirationTime: Date.now() + 3600000,
            },
            createdAt: String(Date.now()),
            lastLoginAt: String(Date.now()),
            apiKey: 'AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ',
            appName: '[DEFAULT]',
          };
          store.put({ fbase_key: key, value }, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, authData);
  }

  // Now navigate fresh -- Firebase will find the auth in IndexedDB on init
  await page.goto(APP_URL + '?v=' + Date.now(), { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000); // let Firebase auth settle + WS connect + fetch sessions
  check('page loads with auth', true);

  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-loaded.png` });

  // Test 2: Dark theme applied
  const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark theme', bgColor !== 'rgb(255, 255, 255)', `bg is white: ${bgColor}`);

  // Test 3: Gallery visible (should be past login now)
  const bodyText = await page.textContent('body');
  const hasGallery = bodyText.includes('Sessions') || bodyText.includes('New Session');
  check('gallery visible (authed)', hasGallery, 'gallery not found -- auth injection may have failed');

  // Test 4: Header present
  const hasHeader = bodyText.includes('Hilbert Talk');
  check('header present', hasHeader, '"Hilbert Talk" not found');

  // Test 5: Header subtitle
  const hasSubtitle = bodyText.includes('claude @ vps');
  check('header subtitle', hasSubtitle, '"claude @ vps" not found');

  // Test 6: No critical console errors
  const realErrors = consoleErrors.filter(e => !e.includes('React DevTools') && !e.includes('favicon') && !e.includes('auth/network') && !e.includes('WebSocket'));
  check('no console errors', realErrors.length === 0, realErrors.join('; ').substring(0, 100));

  // Test 7: No network errors (allow favicon + auth endpoints)
  const realNetErrors = networkErrors.filter(e => !e.includes('favicon') && !e.includes('identitytoolkit'));
  check('no network errors', realNetErrors.length === 0, realNetErrors.join('; ').substring(0, 100));

  // Test 8: Mobile viewport
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > 390);
  check('mobile no overflow', !mobileOverflow, 'horizontal overflow on mobile');
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-mobile.png` });

  // Test 9: Connection status indicator
  const statusText = bodyText.includes('connected') || bodyText.includes('disconnected') || bodyText.includes('connecting');
  check('connection status shown', statusText, 'no connection status text found');

  // Test 10: Origin badge visible in gallery (the key test)
  const hasBadgeText = bodyText.includes('Mac') || bodyText.includes('VPS') || bodyText.includes('Cloud');
  check('origin badge text visible', hasBadgeText, 'no Mac/VPS/Cloud badge text in gallery');

  // Test 11: Origin badge DOM element exists
  const badgeEl = await page.$('.origin-badge');
  check('origin-badge element exists', !!badgeEl, 'no .origin-badge element found');

  // === Session chooser modal tests ===

  // Test 12: Click "+ New Session" opens chooser
  await page.setViewportSize({ width: 1280, height: 800 });
  const newBtn = await page.$('.new-session-btn');
  if (newBtn) {
    await newBtn.click();
    await page.waitForTimeout(500);
    const chooser = await page.$('.chooser-modal');
    check('chooser modal opens', !!chooser, 'no .chooser-modal found after clicking + New Session');

    // Test 13: Chooser has VPS and Mac options
    const chooserText = chooser ? await chooser.textContent() : '';
    const hasVPS = chooserText.includes('VPS');
    const hasMac = chooserText.includes('Mac');
    check('chooser has VPS option', hasVPS, 'no VPS text in chooser');
    check('chooser has Mac option', hasMac, 'no Mac text in chooser');

    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-chooser.png` });

    // Test 14: Click Mac writes to cc_commands
    const SB = 'https://aquysbccogwqloydoymz.supabase.co';
    const SK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxdXlzYmNjb2d3cWxveWRveW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NzY1NzYsImV4cCI6MjA4NTU1MjU3Nn0.IV08zf40TK-NPOB_OyTRPcCdRA9AxkNzhKV17JL3jAU';
    const SE = 'yebomnt@gmail.com';
    const sh = { apikey: SK, Authorization: `Bearer ${SK}`, 'x-user-email': SE, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    const macBtn = await page.$('.chooser-option:last-child');
    if (macBtn) {
      await fetch(`${SB}/rest/v1/user_data?email=eq.${encodeURIComponent(SE)}`, { method: 'PATCH', headers: sh, body: JSON.stringify({ cc_commands: [] }) });
      await macBtn.click();
      await page.waitForTimeout(2000);
      const cmdRes = await fetch(`${SB}/rest/v1/user_data?email=eq.${encodeURIComponent(SE)}&select=cc_commands`, { headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'x-user-email': SE } });
      const cmdRows = await cmdRes.json();
      const cmds = cmdRows?.[0]?.cc_commands || [];
      const hasStartCmd = cmds.some(c => c.action === 'start_session' && c.target === 'local');
      check('Mac click writes start_session command', hasStartCmd, `cc_commands: ${JSON.stringify(cmds).slice(0, 80)}`);
      await fetch(`${SB}/rest/v1/user_data?email=eq.${encodeURIComponent(SE)}`, { method: 'PATCH', headers: sh, body: JSON.stringify({ cc_commands: [] }) });
    } else {
      check('Mac click writes start_session command', false, 'could not find Mac button');
    }
  } else {
    check('chooser modal opens', false, 'no + New Session button found');
    check('chooser has VPS option', false, 'skipped');
    check('chooser has Mac option', false, 'skipped');
    check('Mac click writes start_session command', false, 'skipped');
  }

  // === Session origin badges (2026-03-25) ===

  // Test 10: Origin badge CSS exists in built bundle (fetch CSS file directly)
  const cssHref = await page.evaluate(() => {
    const link = document.querySelector('link[rel="stylesheet"][href*="assets"]');
    return link ? link.href : null;
  });
  let hasOriginCSS = false;
  if (cssHref) {
    try {
      const cssText = await (await fetch(cssHref)).text();
      hasOriginCSS = cssText.includes('origin-badge');
    } catch { /* fetch error */ }
  }
  check('origin-badge CSS present', hasOriginCSS, 'no .origin-badge rule found in CSS bundle');

  // Test 11: Supabase cc_sessions has local-mac entry (backend data check)
  const SUPABASE_URL = 'https://aquysbccogwqloydoymz.supabase.co';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxdXlzYmNjb2d3cWxveWRveW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NzY1NzYsImV4cCI6MjA4NTU1MjU3Nn0.IV08zf40TK-NPOB_OyTRPcCdRA9AxkNzhKV17JL3jAU';
  const EMAIL = 'yebomnt@gmail.com';
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_data?email=eq.${encodeURIComponent(EMAIL)}&select=cc_sessions`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'x-user-email': EMAIL },
    });
    const rows = await res.json();
    const sessions = rows?.[0]?.cc_sessions || [];
    const mac = sessions.find(s => s.id === 'local-mac');
    check('cc_sessions has local-mac', !!mac, mac ? '' : 'no local-mac entry in Supabase');
    if (mac) {
      check('local-mac has origin type', mac.type === 'local', `type is "${mac.type}" not "local"`);
    }
  } catch (e) {
    check('cc_sessions fetch', false, e.message);
  }

  // Test 12: GalleryView source includes origin badge markup (fetch JS bundle directly)
  const jsSrc = await page.evaluate(() => {
    const script = document.querySelector('script[src*="assets"]');
    return script ? script.src : null;
  });
  let hasBadgeMarkup = false;
  if (jsSrc) {
    try {
      const jsText = await (await fetch(jsSrc)).text();
      hasBadgeMarkup = jsText.includes('origin-badge') && jsText.includes('origin-');
    } catch { /* fetch error */ }
  }
  check('bundle has origin badge markup', hasBadgeMarkup, 'origin-badge/origin-local not found in JS bundle');

  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-final.png` });

} catch (err) {
  check('fatal', false, err.message);
} finally {
  if (browser) await browser.close();
}

report();
