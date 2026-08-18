// 生成/刷新 dpop 令牌:打开 Mercari 搜索页,捕获新会话令牌,写入 dpop.json
// 用法:node gen-dpop.js
// 输出:更新本机 dpop.json;把其中的 dpop 值配置到 GitHub Secret(DPOP)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  // 代理:PROXY=direct 直连;未设置默认本机 Clash
  const proxyServer = process.env.PROXY === 'direct' ? null : (process.env.PROXY || 'http://127.0.0.1:7897');
  const ctxProxy = proxyServer ? { proxy: { server: proxyServer } } : {};

  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const ctx = await browser.newContext({
      ...ctxProxy,
      locale: 'ja-JP',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    let dpop = null;
    page.on('request', (r) => {
      if (r.url().includes('entities:search')) dpop = r.headers()['dpop'];
    });
    const kw = encodeURIComponent('もちwhat');
    await page.goto(`https://jp.mercari.com/search?keyword=${kw}&status_on_sale=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    if (dpop) {
      fs.writeFileSync(path.join(__dirname, 'dpop.json'), JSON.stringify({ captured: Date.now(), dpop }));
      console.log('✓ 新令牌已写入 dpop.json(长度 ' + dpop.length + ')');
      console.log('→ 如用于 GitHub 云端,请将该值更新到仓库 Secret(DPOP)');
    } else {
      console.error('✗ 未捕获到 dpop,请检查代理/网络');
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
})();
