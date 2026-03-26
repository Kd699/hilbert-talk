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

  // Close any existing compose windows
  await gmailPage.keyboard.press('Escape');
  await sleep(300);
  await gmailPage.keyboard.press('Escape');
  await sleep(500);

  // First, let's check drafts properly by clicking the Drafts link in sidebar
  const draftsLink = gmailPage.locator('a[href*="#drafts"]').first();
  try {
    await draftsLink.click({ timeout: 5000 });
    await sleep(2000);
    console.log('Navigated to drafts');
    await gmailPage.screenshot({ path: '/tmp/gmail-drafts2.png', fullPage: false });
  } catch (e) {
    console.log('Could not click drafts link, navigating directly');
    await gmailPage.goto('https://mail.google.com/mail/u/0/#drafts');
    await sleep(3000);
    await gmailPage.screenshot({ path: '/tmp/gmail-drafts2.png', fullPage: false });
  }

  // Discard any old dentist drafts - we'll compose fresh
  // Navigate to inbox first
  await gmailPage.goto('https://mail.google.com/mail/u/0/#inbox');
  await sleep(2000);

  // Use keyboard shortcut 'c' to compose (Gmail shortcuts)
  // Or click the Compose button
  const composeBtn = gmailPage.locator('div[role="button"]:has-text("Compose")').first();
  try {
    await composeBtn.click({ timeout: 5000 });
    console.log('Clicked Compose button');
  } catch (e) {
    console.log('Trying gh shortcut...');
    await gmailPage.keyboard.press('c');
  }
  await sleep(2000);

  // Now look for the compose dialog
  const dialog = gmailPage.locator('div[role="dialog"]').first();
  await dialog.waitFor({ timeout: 10000 });
  console.log('Compose dialog opened');
  await sleep(500);

  // Maximize the compose window by clicking the fullscreen/expand button
  // Look for the expand button (two diagonal arrows icon)
  const fullscreenBtn = gmailPage.locator('div[role="dialog"] img[alt="Full screen"], div[role="dialog"] img[aria-label*="full"], div[role="dialog"] button[aria-label*="full"]').first();
  try {
    await fullscreenBtn.click({ timeout: 3000 });
    console.log('Expanded to fullscreen');
    await sleep(1000);
  } catch (e) {
    console.log('Could not find fullscreen button, continuing in popup mode');
  }

  // Fill To field
  const toField = gmailPage.locator('input[aria-label="To recipients"]').first();
  await toField.waitFor({ timeout: 5000 });
  await toField.click();
  await sleep(300);
  await gmailPage.keyboard.type('reception@oaktreedentalnewbury.co.uk', { delay: 15 });
  await sleep(500);

  // Tab to Subject
  await gmailPage.keyboard.press('Tab');
  await sleep(500);

  // Type subject
  await gmailPage.keyboard.type('Appointment Availability', { delay: 15 });
  await sleep(500);

  // Tab to body
  await gmailPage.keyboard.press('Tab');
  await sleep(500);

  // Type body line by line
  const bodyLines = [
    'Hi,',
    '',
    "I hope you're well. I'd like to book an appointment and wanted to share my availability:",
    '',
    '- Tomorrow (Friday 27th March): available from around 12pm onwards',
    '- Monday 30th March: available up to 11am',
    '',
    'Please let me know if any of those times work.',
    '',
    'Kind regards,',
    'Mhlengi',
  ];

  for (let i = 0; i < bodyLines.length; i++) {
    if (bodyLines[i] === '') {
      await gmailPage.keyboard.press('Enter');
    } else {
      await gmailPage.keyboard.type(bodyLines[i], { delay: 8 });
      if (i < bodyLines.length - 1) {
        await gmailPage.keyboard.press('Enter');
      }
    }
    await sleep(100);
  }

  await sleep(1500);

  // Take screenshot of the compose window
  await gmailPage.screenshot({ path: '/tmp/gmail-compose-screenshot.png', fullPage: false });
  console.log('Final screenshot saved to /tmp/gmail-compose-screenshot.png');
  console.log('Email composed and ready for review. NOT SENT.');

  try { browser.disconnect(); } catch(e) {}
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
