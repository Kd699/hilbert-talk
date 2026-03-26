const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const context = contexts[0];
  const page = await context.newPage();
  
  await page.goto('https://mail.google.com/mail/u/0/#inbox');
  await page.waitForTimeout(3000);
  
  // Click compose
  const compose = page.locator('div.T-I.T-I-KE.L3');
  await compose.click();
  await page.waitForTimeout(1500);
  
  // To field
  const toField = page.locator('input[aria-label="To recipients"]');
  await toField.fill('reception@oaktreedentalnewbury.co.uk');
  await page.waitForTimeout(500);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  
  // Subject
  const subject = page.locator('input[name="subjectbox"]');
  await subject.fill('Appointment Availability');
  await page.waitForTimeout(500);
  
  // Tab to body
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  
  // Body via keyboard.type() - TrustedHTML safe
  const body = [
    'Hi,',
    '',
    'I hope you\'re well. I\'d like to book an appointment and wanted to share my availability:',
    '',
    '- Tomorrow (Friday 27th March): available from around 12pm onwards',
    '- Monday 30th March: available up to 11am',
    '',
    'Please let me know if any of those times work.',
    '',
    'Kind regards,',
    'Mhlengi'
  ];
  
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '') {
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.type(body[i], { delay: 10 });
      if (i < body.length - 1) await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(100);
  }
  
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/gmail-compose-screenshot.png' });
  console.log('DONE - compose ready for review at /tmp/gmail-compose-screenshot.png');
  // DO NOT send - leave open for review
})();
