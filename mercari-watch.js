/**
 * もちwhat Mercari 低价监控
 * 访问 jp.mercari.com 搜索页(通过本地代理),抓取在售商品,
 * 筛选价格低于阈值的商品并通知。只通知新出现(未通知过)的低价商品。
 *
 * 用法:
 *   node mercari-watch.js            # 单次抓取并通知
 *   node mercari-watch.js --loop N   # 每 N 分钟循环一次
 */
const { chromium } = require('playwright');

const CONFIG = {
  keyword: 'もちwhat',
  priceLimit: 100000,          // 日元,低于此价格视为低价
  proxy: process.env.PROXY || 'http://127.0.0.1:7897',
  timeout: 60000,              // 页面加载超时(ms)
  stateFile: __dirname + '/seen.json',   // 已通知商品记录
  loopMinutes: 15,
};

// ---------- 抓取 ----------

async function fetchSearchResults() {
  const channel = process.env.BROWSER_CHANNEL || undefined; // 如 "msedge"/"chrome"
  const browser = await chromium.launch({ headless: true, channel });
  try {
    const ctx = await browser.newContext({
      proxy: { server: CONFIG.proxy },
      locale: 'ja-JP',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 2000 },
    });
    const page = await ctx.newPage();

    const url = 'https://jp.mercari.com/search?keyword=' +
      encodeURIComponent(CONFIG.keyword) + '&status_on_sale=1';
    console.log('[*] 访问', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });

    // 等待商品列表渲染(li 卡片,包含商品和 Shops 商品)
    await page.waitForSelector('li[data-testid="item-cell"]', { timeout: CONFIG.timeout });

    // 切换为「新しい順」(新着順)。URL 参数 sort 无效,必须通过下拉框选择。
    // 注意:部分无头浏览器下 selectOption 会静默失败(值不变),需显式验证。
    const sortSel = page.locator('select[name="sortOrder"]');
    await sortSel.selectOption('created_time:desc');
    for (let attempt = 0; attempt < 3; attempt++) {
      // 等列表在新排序下重新渲染完成(selectOption 后列表会重建)
      await page.waitForFunction(() => {
        const sel = document.querySelector('select[name="sortOrder"]');
        return sel && sel.value === 'created_time:desc' &&
          document.querySelectorAll('li[data-testid="item-cell"]').length > 0;
      }, { timeout: CONFIG.timeout });
      const val = await sortSel.inputValue();
      if (val === 'created_time:desc') break;
      await sortSel.selectOption('created_time:desc'); // 重试
      if (attempt === 2) throw new Error('排序切换失败:select 值仍为 ' + val);
    }

    // 商品信息解析。注意:该函数在页面上下文内执行,不能引用 Node 闭包变量。
    // 卡片 innerText 格式: "¥ 7,200 タイトル" (已售罄时还有 "売り切れ" 文本)
    // kw 为传入的搜索关键词,用于从标题中截取商品名(去掉 ¥ 价格前缀)。
    const parseItems = (els, kw) =>
      els.map((el) => {
        const text = (el.innerText || '').replace(/\n+/g, ' ').trim();
        const priceMatch = text.match(/¥\s*([\d,]+)/);
        const soldOut = /売り切れ|予約受付中|出品停止/.test(text);
        const link = el.querySelector('a[href*="/item/"], a[href*="/shops/product/"]');
        const href = link ? link.getAttribute('href') : '';
        const title = text.replace(/^\s*¥\s*[\d,]+\s*/, '').trim();
        const kwIdx = title.indexOf(kw);
        return {
          title,
          name: kwIdx >= 0 ? title.slice(kwIdx) : title, // 商品名(从关键词位置截取)
          price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0,
          url: 'https://jp.mercari.com' + href,
          soldOut,
        };
      });

    // 只保留标题含完整搜索关键词的商品(Mercari 分词搜索会混入无关商品)
    const itemSel = 'li[data-testid="item-cell"]';
    let items = (await page.locator(itemSel).evaluateAll(parseItems, CONFIG.keyword))
      .filter((i) => i.title.includes(CONFIG.keyword) && !i.soldOut && i.price > 0);

    // 滚动到底部加载更多,最多两次
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
      const more = await page.locator(itemSel).count();
      if (more <= items.length) break;
      items = (await page.locator(itemSel).evaluateAll(parseItems, CONFIG.keyword))
        .filter((i) => i.title.includes(CONFIG.keyword) && !i.soldOut && i.price > 0);
    }

    return items;
  } finally {
    await browser.close();
  }
}

// ---------- 去重 ----------

const fs = require('fs');

function loadSeen() {
  try { return new Set(require(CONFIG.stateFile)); } catch { return new Set(); }
}
function saveSeen(seen) {
  // 原子写入:先写临时文件再重命名,避免中途崩溃损坏 seen.json
  const tmp = CONFIG.stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify([...seen], null, 2));
  fs.renameSync(tmp, CONFIG.stateFile);
}

// ---------- 通知 ----------

const { execFileSync } = require('child_process');

async function notify(items) {
  // 逐条输出完整信息(价格 + 商品名 + 链接),不截断
  const lines = items.map((i) => `¥${i.price.toLocaleString()} ${i.name || i.title}\n${i.url}`);
  const body = lines.join('\n\n');

  // 1) Windows 桌面通知(推荐,无需配置)
  try {
    const message = lines.slice(0, 5).join('\n'); // toast 只显示前 5 条,避免过长
    execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      __dirname + '/toast.ps1',
    ], {
      env: { ...process.env, TOAST_TITLE: `低价! ${items.length} 件もちwhat`, TOAST_MESSAGE: message },
      stdio: 'ignore',
    });
    console.log('[✓] 已发送桌面通知');
  } catch (e) { console.error('[!] 桌面通知失败:', e.message); }

  // 2) Server酱 → 微信(配置 SCT_KEY 后启用)。SendKey 在 https://sct.ftqq.com 获取
  if (process.env.SCT_KEY) {
    try {
      const title = `低价! ${items.length} 件もちwhat`;
      const resp = await fetch(`https://sctapi.ftqq.com/${process.env.SCT_KEY}.send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title, desp: body }),
      });
      const result = await resp.json();
      if (result.code === 0) console.log('[✓] 已发送 Server酱(微信)通知');
      else console.error('[!] Server酱通知失败:', JSON.stringify(result));
    } catch (e) { console.error('[!] Server酱通知失败:', e.message); }
  }

  // 3) 企业微信机器人(配置 WECOM_WEBHOOK 后启用),完整列表
  if (process.env.WECOM_WEBHOOK) {
    try {
      await fetch(process.env.WECOM_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: body } }),
      });
      console.log('[✓] 已发送企业微信通知');
    } catch (e) { console.error('[!] 企业微信通知失败:', e.message); }
  }

  // 4) 控制台输出(始终),完整列表
  console.log('\n[低价商品 ' + items.length + ' 件]');
  console.log(body);
}

// ---------- 主流程 ----------

async function runOnce() {
  const items = await fetchSearchResults();
  console.log(`[*] 共抓到 ${items.length} 件在售商品`);

  const cheap = items.filter((i) => i.price < CONFIG.priceLimit);
  const seen = loadSeen();
  const fresh = cheap.filter((i) => !seen.has(i.url));
  fresh.forEach((i) => seen.add(i.url));
  saveSeen(seen);

  console.log(`[*] 低价 ${cheap.length} 件,新出现 ${fresh.length} 件`);
  if (fresh.length > 0) await notify(fresh);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--loop')) {
    const idx = args.indexOf('--loop');
    const minutes = parseInt(args[idx + 1], 10) || CONFIG.loopMinutes;
    console.log(`[*] 循环模式:每 ${minutes} 分钟检查一次`);
    while (true) {
      try { await runOnce(); } catch (e) { console.error('[!] 本次抓取失败:', e.message); }
      await new Promise((r) => setTimeout(r, minutes * 60 * 1000));
    }
  } else {
    await runOnce();
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
