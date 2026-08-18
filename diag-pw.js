// 诊断:runner 上 Playwright 能否成功访问 Mercari 搜索(绕过 curl 风控)
const { chromium } = require('playwright');
(async () => {
  console.log('=== 开始 Playwright 诊断 ===');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: 'ja-JP',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  let apiStatus = null;
  let apiBody = null;
  let dpop = null;
  page.on('response', async (r) => {
    if (r.url().includes('entities:search')) {
      apiStatus = r.status();
      try { apiBody = await r.text(); } catch {}
    }
  });
  page.on('request', (r) => {
    if (r.url().includes('entities:search')) dpop = r.headers()['dpop'] || null;
  });
  const kw = encodeURIComponent('もちwhat');
  await page.goto(`https://jp.mercari.com/search?keyword=${kw}&status_on_sale=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  console.log('页面 title:', await page.title());
  console.log('API 请求状态:', apiStatus);
  console.log('捕获 dpop:', dpop ? '是(长度 ' + dpop.length + ')' : '否');
  if (apiBody) {
    try {
      const j = JSON.parse(apiBody);
      console.log('API 响应 items:', j.items ? j.items.length + ' 件' : '无 items');
      if (j.items && j.items[0]) console.log('第一条:', j.items[0].name.slice(0, 40), '¥' + j.items[0].price);
    } catch {
      console.log('API 响应(非JSON):', apiBody.slice(0, 100));
    }
  }
  await browser.close();
  console.log('=== 诊断结束 ===');
})();
