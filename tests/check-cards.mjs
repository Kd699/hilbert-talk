import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

const authRes = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({email:'ghost@hilbert.test',password:'ghost-test-2026!',returnSecureToken:true})
});
const auth = await authRes.json();

await page.goto('https://hilbert-talk.web.app', {waitUntil:'commit'});
await page.evaluate(({idToken,refreshToken,localId,email}) => {
  return new Promise((resolve) => {
    const req = indexedDB.open('firebaseLocalStorageDb',1);
    req.onupgradeneeded = () => { if(!req.result.objectStoreNames.contains('firebaseLocalStorage')) req.result.createObjectStore('firebaseLocalStorage'); };
    req.onsuccess = () => {
      const tx = req.result.transaction('firebaseLocalStorage','readwrite');
      tx.objectStore('firebaseLocalStorage').put({fbase_key:'firebase:authUser:AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ:[DEFAULT]',value:{uid:localId,email,stsTokenManager:{refreshToken,accessToken:idToken,expirationTime:Date.now()+3600000},apiKey:'AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ',appName:'[DEFAULT]'}},'firebase:authUser:AIzaSyBXIWMZ83HaVJ8SeQwyotKRf7_z-hmB3XQ:[DEFAULT]');
      tx.oncomplete = resolve;
    };
  });
}, auth);

await page.goto('https://hilbert-talk.web.app?v='+Date.now(), {waitUntil:'networkidle'});
await page.waitForTimeout(6000);
const bodyText = await page.textContent('body');
console.log('Has Sessions:', bodyText.includes('Sessions'));
console.log('Has Mac:', bodyText.includes('Mac'));
console.log('Has WA-Chat:', bodyText.includes('WA-Chat'));
console.log('Has Loading:', bodyText.includes('Loading'));

const cards = await page.$$('.session-card');
console.log('Cards:', cards.length);
for (const card of cards) {
  const text = await card.textContent();
  console.log('  Card:', text.replace(/\s+/g,' ').trim());
}
await page.screenshot({path:'/tmp/ghost2-fast/watest-cards.png', fullPage: true});
await browser.close();
