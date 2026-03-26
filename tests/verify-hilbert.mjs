import { chromium } from 'playwright-core';
const v = await (await fetch('http://localhost:9222/json/version')).json();
const browser = await chromium.connectOverCDP(v.webSocketDebuggerUrl, {timeout:120000});
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.goto('https://hilbert-talk.web.app?v='+Date.now(), {waitUntil:'networkidle',timeout:15000});
await page.waitForTimeout(5000);
const cards = await page.$$('.session-card');
console.log(`${cards.length} cards`);
for (const card of cards) {
  const text = await card.textContent();
  if (text.includes('WA-Chat')) {
    console.log('Clicking WA-Chat card...');
    await card.click();
    break;
  }
}
await page.waitForTimeout(5000);
const body = await page.textContent('body');
console.log('Response visible:', body.includes('local Mac Claude session'));
console.log('Has user msg:', body.includes('hi'));
await page.screenshot({path:'/tmp/ghost-selfplay/hilbert-verified.png', fullPage:true});
await page.close();
console.log('Screenshot saved');
