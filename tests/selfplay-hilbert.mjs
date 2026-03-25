import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';

const DIR = '/tmp/ghost-selfplay';
mkdirSync(DIR, { recursive: true });

const API_KEY = 'AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

// Auth
const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({email:'ghost@hilbert.test',password:'ghost-test-2026!',returnSecureToken:true})
});
const auth = await authRes.json();

// Auth injection: MUST use 'commit' (not domcontentloaded) to beat Firebase JS init
await page.goto('https://hilbert-talk.web.app', {waitUntil:'commit', timeout: 10000});
await page.evaluate(({idToken,refreshToken,localId,email,apiKey}) => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('firebaseLocalStorageDb',1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) db.createObjectStore('firebaseLocalStorage');
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('firebaseLocalStorage','readwrite');
      const store = tx.objectStore('firebaseLocalStorage');
      const key = `firebase:authUser:${apiKey}:[DEFAULT]`;
      store.put({fbase_key:key,value:{
        uid:localId, email, emailVerified:false, isAnonymous:false,
        stsTokenManager:{refreshToken,accessToken:idToken,expirationTime:Date.now()+3600000},
        createdAt:String(Date.now()), lastLoginAt:String(Date.now()),
        apiKey, appName:'[DEFAULT]',
      }},key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}, {...auth, apiKey: API_KEY});

// Navigate fresh -- Firebase finds auth in IndexedDB on init
await page.goto('https://hilbert-talk.web.app?v='+Date.now(), {waitUntil:'networkidle', timeout: 15000});
await page.waitForTimeout(4000);

// Screenshot 1: Gallery with WA-Chat card
await page.screenshot({path:`${DIR}/01-gallery.png`, fullPage:true});
const cards = await page.$$('.session-card');
console.log(`Gallery cards: ${cards.length}`);
for (const card of cards) {
  const text = await card.textContent();
  console.log(`  Card: ${text.replace(/\s+/g,' ').trim()}`);
}

// Find and click WA-Chat card
let clicked = false;
for (const card of cards) {
  const text = await card.textContent();
  if (text.includes('WA-Chat')) {
    console.log('Clicking WA-Chat card...');
    await card.click();
    clicked = true;
    break;
  }
}

if (clicked) {
  await page.waitForTimeout(8000); // Wait for LocalChatView to load + poll from Supabase
  await page.screenshot({path:`${DIR}/02-local-chat-view.png`, fullPage:true});

  const bodyText = await page.textContent('body');
  console.log('LocalChatView visible:', bodyText.includes('Local session') || bodyText.includes('Waiting for messages') || bodyText.includes('what did we build'));
  console.log('Has chat messages:', bodyText.includes('what did we build today') || bodyText.includes('hello'));
  console.log('Has Mac badge:', bodyText.includes('Mac'));

  // Check for message elements
  const messages = await page.$$('.message');
  console.log(`Message elements: ${messages.length}`);
} else {
  console.log('NO WA-Chat card found to click');
}

await browser.close();
console.log(`Screenshots saved to ${DIR}/`);
