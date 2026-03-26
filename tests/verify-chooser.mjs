import { chromium } from 'playwright-core';
const v = await (await fetch('http://localhost:9222/json/version')).json();
const browser = await chromium.connectOverCDP(v.webSocketDebuggerUrl, {timeout:120000});
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.goto('https://hilbert-talk.web.app?v='+Date.now(), {waitUntil:'networkidle',timeout:15000});
await page.waitForTimeout(4000);

// Click + New Session
const btn = await page.$('.new-session-btn');
if (btn) await btn.click();
await page.waitForTimeout(1000);

await page.screenshot({path:'/tmp/ghost-selfplay/chooser-updated.png', fullPage:true});
const body = await page.textContent('body');
console.log('Has cc-ht hint:', body.includes('cc-ht'));
console.log('Has VPS option:', body.includes('VPS'));
await page.close();
