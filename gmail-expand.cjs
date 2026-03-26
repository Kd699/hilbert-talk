const { chromium } = require('playwright-core');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();

  // Find the Gmail page
  let gmailPage = null;
  for (const p of pages) {
    const url = p.url();
    if (url.includes('mail.google.com')) {
      gmailPage = p;
      break;
    }
  }

  if (!gmailPage) {
    console.error('No Gmail page found');
    process.exit(1);
  }

  // Click the expand/maximize button on the minimized compose window
  // The minimized compose bar shows at bottom - click on it to expand
  const expandBtn = gmailPage.locator('img[aria-label="Maximize"]').first();
  try {
    await expandBtn.click({ timeout: 3000 });
    await sleep(1000);
  } catch (e) {
    // Try clicking on the compose bar itself to expand
    console.log('Trying to click compose bar to expand...');
    const composeBar = gmailPage.locator('div.dw span').first();
    try {
      await composeBar.click({ timeout: 3000 });
      await sleep(1000);
    } catch (e2) {
      // Try the subject line in the minimized bar
      console.log('Trying subject in minimized bar...');
      const subjectBar = gmailPage.locator('span:has-text("Appointment Availability")').first();
      await subjectBar.click({ timeout: 5000 });
      await sleep(1000);
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
