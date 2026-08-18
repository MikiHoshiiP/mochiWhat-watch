/**
 * もちwhat Mercari 低价监控
 * 只看「最新上架的一件商品」:新着順第一件,当价格低于阈值时通知。
 * 同一商品只通知一次;未通知过的高价商品会持续评估(降价后触发)。
 * 纯 API 直连(约 0.5~1 秒/次);dpop 令牌失效时自动刷新并重试。
 *
 * 用法:
 *   node mercari-watch.js            # 单次检查并通知
 *   node mercari-watch.js --loop N   # 每 N 分钟循环一次
 */
const { chromium } = require('playwright');
const { searchViaApi } = require('./mercari-api');

const CONFIG = {
  keyword: 'もちwhat',
  priceLimit: 100000,          // 日元,低于此价格视为低价
  proxy: process.env.PROXY || 'http://127.0.0.1:7897',
  timeout: 60000,              // 页面加载超时(ms)
  stateFile: __dirname + '/seen.json',   // 已通知商品记录
  loopMinutes: 1,
};

// ---------- 抓取 ----------
// 纯 API 直连。dpop 令牌失效(401)时,自动用 Playwright 打开搜索页

async function fetchSearchResults(limit = 0) {
  const opts = {
    sort: 'SORT_CREATED_TIME',
    pageSize: limit > 0 ? Math.min(limit, 120) : 120,
    maxPages: limit > 0 ? 1 : 4,
  };
  try {
    const items = await searchViaApi(CONFIG.keyword, opts);
    if (items.length > 0) {
      console.log('[*] 使用 API 直连,共 ' + items.length + ' 件');
      return limit > 0 ? items.slice(0, limit) : items;
    }
  } catch (e) {
    console.warn('[!] API 调用失败:', e.message);
  }
  // API 不可用:自动刷新 dpop 令牌后重试一次
  console.log('[*] 尝试刷新 dpop 令牌…');
  const refreshed = await refreshDpop();
  if (refreshed) {
    const items = await searchViaApi(CONFIG.keyword, opts);
    if (items.length > 0) {
      console.log('[*] 令牌已刷新,API 重试成功,共 ' + items.length + ' 件');
      return limit > 0 ? items.slice(0, limit) : items;
    }
  }
  throw new Error('API 直连失败且令牌刷新失败');
}

// 用 Playwright 打开搜索页,捕获 API 请求中的新 dpop 令牌并写入 dpop.json
async function refreshDpop() {
  const channel = process.env.BROWSER_CHANNEL || undefined; // 如 "msedge"/"chrome"
  const browser = await chromium.launch({ headless: true, channel });
  try {
    const ctx = await browser.newContext({
      proxy: { server: CONFIG.proxy },
      locale: 'ja-JP',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    let dpop = null;
    page.on('request', (r) => {
      if (r.url().includes('entities:search')) dpop = r.headers()['dpop'];
    });
    const url = 'https://jp.mercari.com/search?keyword=' + encodeURIComponent(CONFIG.keyword) + '&status_on_sale=1';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
    await page.waitForTimeout(8000); // 等待 API 请求发出
    if (dpop) {
      fs.writeFileSync(__dirname + '/dpop.json', JSON.stringify({ captured: Date.now(), dpop }));
      return true;
    }
    return false;
  } catch (e) {
    console.error('[!] 令牌刷新失败:', e.message);
    return false;
  } finally {
    await browser.close();
  }
}

const fs = require('fs');

// ---------- 日志 ----------
// 脚本自行写 watch.log(追加),不再依赖 bat 重定向(重定向会持有文件句柄,
// 导致轮转 rename 失败)。console 输出同步写日志;超限自动轮转为 .old。

const LOG_FILE = __dirname + '/watch.log';
const LOG_LIMIT = 1 * 1024 * 1024; // 1MB,超过则轮转

function rotateLog() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size <= LOG_LIMIT) return;
    const old = LOG_FILE + '.old';
    fs.rmSync(old, { force: true });
    fs.renameSync(LOG_FILE, old);
    fs.writeFileSync(LOG_FILE, ''); // 立即重建空日志
    console.log(`[log] watch.log 超 ${(LOG_LIMIT / 1024 / 1024).toFixed(0)}MB,已轮转为 watch.log.old`);
  } catch (e) { console.error('[!] 日志轮转失败:', e.message); }
}

// console 输出同步写入 watch.log(瞬时句柄,不阻塞轮转)
const origLog = console.log;
const origError = console.error;
console.log = (...args) => {
  origLog(...args);
  try { fs.appendFileSync(LOG_FILE, args.join(' ') + '\n'); } catch {}
};
console.error = (...args) => {
  origError(...args);
  try { fs.appendFileSync(LOG_FILE, '[ERR] ' + args.join(' ') + '\n'); } catch {}
};

// ---------- 去重 ----------

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
      env: { ...process.env, TOAST_TITLE: `低价! ¥${items[0].price.toLocaleString()} もちwhat`, TOAST_MESSAGE: message },
      stdio: 'ignore',
    });
    console.log('[✓] 已发送桌面通知');
  } catch (e) { console.error('[!] 桌面通知失败:', e.message); }

  // 2) Server酱 → 微信(配置 SCT_KEY 后启用)。SendKey 在 https://sct.ftqq.com 获取
  if (process.env.SCT_KEY) {
    try {
      const title = `低价! ¥${items[0].price.toLocaleString()} もちwhat`;
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
// 需求:只看「最新上架的一件」商品,当它低于价格阈值时通知。
// 新着順下第一件即为最新;同一商品只通知一次(seen.json 去重)。

async function runOnce() {
  // 只取前几件即可(新着順第一件就是最新商品)
  const items = await fetchSearchResults(5);
  if (items.length === 0) {
    console.log('[*] 未抓到商品');
    return;
  }
  const latest = items[0]; // 最新上架的商品
  console.log(`[*] 最新商品:${latest.title} ¥${latest.price.toLocaleString()} (共${items.length}件在售)`);

  const seen = loadSeen();
  const isFresh = !seen.has(latest.url); // 未通知过

  if (latest.price < CONFIG.priceLimit && isFresh) {
    console.log(`[*] 最新商品价格 ¥${latest.price.toLocaleString()} < ${CONFIG.priceLimit},通知!`);
    seen.add(latest.url); // 只有实际通知过才记录,避免降价后无法再次评估
    saveSeen(seen);
    await notify([latest]);
  } else if (!isFresh) {
    console.log('[*] 该商品已通知过,跳过');
  } else {
    console.log(`[*] 最新商品价格 ¥${latest.price.toLocaleString()} >= ${CONFIG.priceLimit},不通知(降价后会再次评估)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--loop')) {
    const idx = args.indexOf('--loop');
    const minutes = parseInt(args[idx + 1], 10) || CONFIG.loopMinutes;
    console.log(`[*] 循环模式:每 ${minutes} 分钟检查一次`);
    while (true) {
      rotateLog(); // 每次循环前检查日志大小
      try { await runOnce(); } catch (e) { console.error('[!] 本次抓取失败:', e.message); }
      await new Promise((r) => setTimeout(r, minutes * 60 * 1000));
    }
  } else {
    await runOnce();
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
