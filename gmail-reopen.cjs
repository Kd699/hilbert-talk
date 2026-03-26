const { chromium } = require('playwright-core');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();

  // Find the Gmail page (the compose tab we opened)
  let gmailPage = null;
  for (const p of pages) {
    const url = p.url();
    console.log('Page:', url);
    if (url.includes('mail.google.com')) {
      gmailPage = p;
    }
  }

  if (!gmailPage) {
    console.error('No Gmail page found');
    process.exit(1);
  }

  await gmailPage.bringToFront();
  await sleep(500);

  // Navigate directly to compose
  await gmailPage.goto('https://mail.google.com/mail/u/0/#compose');
  await sleep(3000);

  // Check if a compose window is open or if we need to find draft
  // Look for compose dialog
  const composeDialog = gmailPage.locator('div[role="dialog"]').first();
  try {
    await composeDialog.waitFor({ timeout: 5000 });
    console.log('Compose dialog found');
  } catch (e) {
    console.log('No compose dialog, looking for minimized compose...');
    // Look for minimized compose at bottom
    const minimized = gmailPage.locator('td.Ht div.aDi').first();
    try {
      await minimized.click({ timeout: 3000 });
      console.log('Clicked minimized compose');
      await sleep(1000);
    } catch (e2) {
      console.log('Cannot find minimized, checking drafts...');
    }
  }

  await sleep(1000);
  await gmailPage.screenshot({ path: '/tmp/gmail-compose-screenshot.png', fullPage: false });
  console.log('Screenshot saved');

  try { browser.disconnect(); } catch(e) {}
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
