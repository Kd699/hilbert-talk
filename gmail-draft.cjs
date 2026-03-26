const { chromium } = require('playwright-core');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();

  // Find Gmail page
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

  await gmailPage.bringToFront();
  await sleep(500);

  // Close any open compose windows first (press Escape)
  await gmailPage.keyboard.press('Escape');
  await sleep(500);
  await gmailPage.keyboard.press('Escape');
  await sleep(1000);

  // Navigate to drafts
  await gmailPage.goto('https://mail.google.com/mail/u/0/#drafts');
  await sleep(3000);

  await gmailPage.screenshot({ path: '/tmp/gmail-drafts.png', fullPage: false });
  console.log('Drafts screenshot saved');

  // Click on the draft with "Appointment Availability"
  const draftRow = gmailPage.locator('tr:has-text("Appointment Availability")').first();
  try {
    await draftRow.click({ timeout: 5000 });
    console.log('Clicked on draft');
    await sleep(3000);
    await gmailPage.screenshot({ path: '/tmp/gmail-compose-screenshot.png', fullPage: false });
    console.log('Draft compose screenshot saved');
  } catch (e) {
    console.log('Could not find draft row, trying span...');
    const draftSpan = gmailPage.locator('span:has-text("Appointment Availability")').first();
    await draftSpan.click({ timeout: 5000 });
    await sleep(3000);
    await gmailPage.screenshot({ path: '/tmp/gmail-compose-screenshot.png', fullPage: false });
    console.log('Draft compose screenshot saved');
  }

  try { browser.disconnect(); } catch(e) {}
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
