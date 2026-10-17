const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const respond = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/session')) respond({ authenticated: true });
    else if (url.includes('/login')) respond({ ok: true });
    else if (url.includes('/status') || url.includes('/overview')) respond({ 
      state: 'online', tunnel: true, ims: 'registered', engine: 'running', 
      linphone: true, provisioned: true, calls: [], 
      line: { msisdn: '+8613800138000', imsi: '460001234567890', iccid: '8986001234567890', imei: '861234567890123', epdg: 'epdg.ims.mnc001.mcc460.3gppnetwork.org', smsc: '8613800100500' },
      container: { running: true }, tunnel_state: 'CONNECTED', ims_state: 'Registered', linphone_online: true,
      bark_configured: true, bark_encrypted: false, events: []
    });
    else if (url.includes('/messages') || url.includes('/sms')) respond({ 
      messages: [{ id: 1, peer: '+8613800138000', dir: 'IN', body: '你好，这是新界面效果预览！', time: '07:42', sender: '13800138000' }]
    });
    else if (url.includes('/calls')) respond({ calls: [{ id: 1, peer: '+8613912345678', dir: 'in', time: '07:30', status: 'answered' }] });
    else if (url.includes('/logs')) respond({ logs: 'INFO Starting simvowifi engine...\nINFO Tunnel established\nINFO IMS registered successfully\n' });
    else if (url.includes('/readers')) respond({ readers: [{ idx: 0, name: 'ACR39' }] });
    else if (url.includes('/bark')) respond({ server: 'https://api.day.app', key: 'demo', call_sound: 'alarm', call_level: 'critical', call_group: 'VoIP', call_isArchive: 1, include_body: true, encrypt: { algorithm: 'AES128', mode: 'CBC', key: '', iv: '' } });
    else if (url.includes('/linphone')) respond({ server: '192.168.5.202', port: 5060, username: 'sipuser', password: 'sippass', transport: 'UDP' });
    else if (url.includes('/config')) respond({ config: { bark: { server: 'https://api.day.app', key: 'demo', call_sound: 'alarm', call_level: 'critical', call_group: 'VoIP', call_isArchive: 1, include_body: true, encrypt: { algorithm: 'AES128', mode: 'CBC', key: '', iv: '' } }, sip: { enabled: true } } });
    else respond({ ok: true });
  });

  page.on('pageerror', err => console.log(`[ERROR] ${err.message}`));

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/01-login.png' });
  console.log('📸 01-login');

  // Login
  await page.fill('input[type="password"]', 'demo123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/tmp/02-dashboard.png' });
  console.log('📸 02-dashboard');

  // Navigate to each page
  const pages = [
    ['设置', '03-settings'],
    ['短信', '04-messages'],
    ['软电话', '05-softphone'],
    ['SIM 开通', '06-provision'],
    ['日志', '07-logs']
  ];

  for (const [label, file] of pages) {
    try {
      await page.evaluate((lbl) => {
        const btns = document.querySelectorAll('.app-nav-button');
        for (const btn of btns) {
          if (btn.textContent.includes(lbl)) { btn.click(); return; }
        }
      }, label);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `/tmp/${file}.png` });
      console.log(`📸 ${file}`);
    } catch (e) {
      console.log(`❌ ${label}: ${e.message}`);
    }
  }

  await browser.close();
  console.log('✅ Done!');
})();
