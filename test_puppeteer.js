const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  // Navigate to local server
  await page.goto('http://localhost:3000/?code=wu9ZxYn7QiPJCqSZO2Zy&state=cKfKrJOl9KtD&liffClientId=2011786627&liffRedirectUri=https%3A%2F%2Flocalhost%3A3000', { waitUntil: 'networkidle0' });
  
  // Try to click Admin Dashboard
  try {
    await page.evaluate(() => {
      // simulate admin session
      sessionStorage.setItem('hlg_admin_session_v2', '1');
    });
    
    // reload with admin session
    await page.reload({ waitUntil: 'networkidle0' });
    
    await page.evaluate(() => {
      if (typeof openAdminDashboard === 'function') openAdminDashboard();
    });
    
    // wait a bit to see if flickering happens
    await new Promise(r => setTimeout(r, 2000));
  } catch(e) {
    console.error("Script error:", e);
  }
  
  await browser.close();
})();
