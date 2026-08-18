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
// 优先 API 直连(curl,快)。curl 被风控(403,如 CI 环境)或 dpop 失效时,
// 回退浏览器模式:Playwright 打开搜索页,拦截页面发出的 API 响应。
// 两种模式共享同一商品解析逻辑。

async function fetchSearchResults(limit = 0) {
  const opts = {
    sort: 'SORT_CREATED_TIME',
    pageSize: limit > 0 ? Math.min(limit, 120) : 120,
    maxPages: limit > 0 ? 1 : 4,
  };
  let items;
  try {
    items = await searchViaApi(CONFIG.keyword, opts); // 仅网络/解析错误抛异常
    if (items.length > 0) {
      console.log('[*] 使用 API 直连,共 ' + items.length + ' 件');
      return limit > 0 ? items.slice(0, limit) : items;
    }
    console.warn('[!] API 返回空结果,回退浏览器模式');
  } catch (e) {
    console.warn('[!] API 调用失败,回退浏览器模式:', e.message);
  }
  // 回退:浏览器抓取(拦截页面 API 响应)
  items = await fetchViaBrowser();
  if (items.length > 0) {
    console.log('[*] 使用浏览器抓取,共 ' + items.length + ' 件');
    return limit > 0 ? items.slice(0, limit) : items;
  }
  // 浏览器模式也失败 → 尝试刷新 dpop 后重试 API(仅当 API 失败且是令牌问题时)
  console.log('[*] 尝试刷新 dpop 令牌…');
  const refreshed = await refreshDpop();
  if (refreshed) {
    items = await searchViaApi(CONFIG.keyword, opts);
    if (items.length > 0) {
      console.log('[*] 令牌已刷新,API 重试成功,共 ' + items.length + ' 件');
      return limit > 0 ? items.slice(0, limit) : items;
    }
  }
  return [];
}

// Playwright 打开搜索页,拦截页面发出的 entities:search 响应并解析商品
async function fetchViaBrowser() {
  const channel = process.env.BROWSER_CHANNEL || undefined;
  let browser = null;
  try {
    const proxyServer = process.env.PROXY === 'direct' ? null : (process.env.PROXY || 'http://127.0.0.1:7897');
    const ctxProxy = proxyServer ? { proxy: { server: proxyServer } } : {};
    browser = await chromium.launch({ headless: true, channel });
    const ctx = await browser.newContext({
      ...ctxProxy,
      locale: 'ja-JP',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    let apiJson = null;
    page.on('response', async (r) => {
      if (r.url().includes('entities:search') && r.status() === 200 && !apiJson) {
        try { apiJson = JSON.parse(await r.text()); } catch {}
      }
    });
    const url = 'https://jp.mercari.com/search?keyword=' + encodeURIComponent(CONFIG.keyword) + '&status_on_sale=1';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
    await page.waitForTimeout(8000); // 等待 API 响应
    if (!apiJson) return [];
    return (apiJson.items || []).map((it) => ({
      id: it.id,
      title: it.name || '',
      name: it.name || '',
      price: parseInt(it.price, 10) || 0,
      status: it.status || '',
      created: it.created ? parseInt(it.created, 10) : 0,
      url: 'https://jp.mercari.com/item/' + it.id,
    }));
  } catch (e) {
    console.error('[!] 浏览器抓取失败:', e.message);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

// 用 Playwright 打开搜索页,捕获 API 请求中的新 dpop 令牌并写入 dpop.json
async function refreshDpop() {
  const channel = process.env.BROWSER_CHANNEL || undefined; // 如 "msedge"/"chrome"
  let browser = null;
  try {
    // 代理:PROXY=direct 时不配置(CI/海外直连);未设置默认走本地 Clash
    const proxyServer = process.env.PROXY === 'direct' ? null : (process.env.PROXY || 'http://127.0.0.1:7897');
    const ctxProxy = proxyServer ? { proxy: { server: proxyServer } } : {};
    browser = await chromium.launch({ headless: true, channel }); // 放 try 内,启动失败按刷新失败处理
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
    const url = 'https://jp.mercari.com/search?keyword=' + encodeURIComponent(CONFIG.keyword) + '&status_on_sale=1';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
    await page.waitForTimeout(8000); // 等待 API 请求发出
    if (dpop) {
      fs.writeFileSync(__dirname + '/dpop.json', JSON.stringify({ captured: Date.now(), dpop }));
      process.env.DPOP = dpop; // 同步更新环境变量,刷新后重试直接使用新令牌
      return true;
    }
    return false;
  } catch (e) {
    console.error('[!] 令牌刷新失败:', e.message);
    return false;
  } finally {
    if (browser) await browser.close();
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
    let stat;
    try { stat = fs.statSync(LOG_FILE); } catch { return; } // 文件不存在:无需轮转
    if (stat.size <= LOG_LIMIT) return;
    const old = LOG_FILE + '.old';
    fs.rmSync(old, { force: true });
    fs.renameSync(LOG_FILE, old);
    fs.writeFileSync(LOG_FILE, ''); // 立即重建空日志
    console.log(`[log] watch.log 超 ${(LOG_LIMIT / 1024 / 1024).toFixed(0)}MB,已轮转为 watch.log.old`);
  } catch (e) { console.error('[!] 日志轮转失败:', e.message); }
}

// console 输出同步写入 watch.log(瞬时句柄,不阻塞轮转)。带时间戳便于排查。
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;
const ts = () => '[' + new Date().toLocaleString('zh-CN', { hour12: false }) + '] ';
console.log = (...args) => {
  origLog(...args);
  try { fs.appendFileSync(LOG_FILE, ts() + args.join(' ') + '\n'); } catch {}
};
console.error = (...args) => {
  origError(...args);
  try { fs.appendFileSync(LOG_FILE, ts() + '[ERR] ' + args.join(' ') + '\n'); } catch {}
};
console.warn = (...args) => {
  origWarn(...args);
  try { fs.appendFileSync(LOG_FILE, ts() + '[WARN] ' + args.join(' ') + '\n'); } catch {}
};

// ---------- 去重 ----------

function loadSeen() {
  // 注意:不能用 require() 读取(有模块缓存,磁盘更新后仍返回旧数据)
  try { return new Set(JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8'))); } catch { return new Set(); }
}
function saveSeen(seen) {
  // 原子写入:先写临时文件再重命名,避免中途崩溃损坏 seen.json
  const tmp = CONFIG.stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify([...seen], null, 2));
  fs.renameSync(tmp, CONFIG.stateFile);
}

// ---------- 通知 ----------
// 返回是否至少有一个渠道成功送达。全部失败时返回 false,
// 调用方不应把商品标记为已通知(否则失败后不会重试)。

const { execFileSync } = require('child_process');
const FETCH_TIMEOUT_MS = 10000; // 网络推送超时

async function notify(items) {
  // 逐条输出完整信息(价格 + 商品名 + 链接),不截断
  const lines = items.map((i) => `¥${i.price.toLocaleString()} ${i.name || i.title}\n${i.url}`);
  const body = lines.join('\n\n');
  let delivered = false;

  // 1) Windows 桌面通知(仅 Windows 平台;服务器/Linux 自动跳过)
  if (process.platform === 'win32') {
    try {
      const message = lines.slice(0, 5).join('\n'); // toast 只显示前 5 条,避免过长
      execFileSync('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        __dirname + '/toast.ps1',
      ], {
        env: { ...process.env, TOAST_TITLE: `低价! ¥${items[0].price.toLocaleString()} もちwhat`, TOAST_MESSAGE: message },
        stdio: 'ignore',
        timeout: 10000, // 防止 PowerShell 卡死
      });
      console.log('[✓] 已发送桌面通知');
      delivered = true;
    } catch (e) { console.error('[!] 桌面通知失败:', e.message); }
  } else {
    console.log('[*] 非 Windows 平台,跳过桌面通知');
  }

  // 2) Server酱 → 微信(配置 SCT_KEY 后启用)。SendKey 在 https://sct.ftqq.com 获取
  if (process.env.SCT_KEY) {
    try {
      const title = `低价! ¥${items[0].price.toLocaleString()} もちwhat`;
      const resp = await fetch(`https://sctapi.ftqq.com/${process.env.SCT_KEY}.send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title, desp: body }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), // 超时控制
      });
      const result = await resp.json();
      if (result.code === 0) { console.log('[✓] 已发送 Server酱(微信)通知'); delivered = true; }
      else console.error('[!] Server酱通知失败:', JSON.stringify(result));
    } catch (e) { console.error('[!] Server酱通知失败:', e.message); }
  }

  // 3) 企业微信机器人(配置 WECOM_WEBHOOK 后启用),完整列表
  if (process.env.WECOM_WEBHOOK) {
    try {
      const resp = await fetch(process.env.WECOM_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: body } }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), // 超时控制
      });
      const result = await resp.json();
      // 企业微信成功响应含 errcode: 0;400/限流等为失败
      if (result.errcode === 0) { console.log('[✓] 已发送企业微信通知'); delivered = true; }
      else console.error('[!] 企业微信通知失败:', JSON.stringify(result));
    } catch (e) { console.error('[!] 企业微信通知失败:', e.message); }
  }

  // 4) 控制台输出(始终),完整列表
  console.log('\n[低价商品 ' + items.length + ' 件]');
  console.log(body);

  return delivered;
}

// ---------- 告警 ----------
// 监控异常时推送(连续失败等)。与 notify 分离:不改变商品去重语义。
// 渠道:桌面 toast(如有 SCT_KEY) + Server酱。告警限频:同一级别至少隔 30 分钟。

let lastAlertAt = 0;
const ALERT_MIN_INTERVAL = 30 * 60 * 1000; // 30 分钟

async function sendAlert(message) {
  const now = Date.now();
  if (now - lastAlertAt < ALERT_MIN_INTERVAL) return; // 限频
  lastAlertAt = now;
  if (process.platform === 'win32') {
    try {
      const msg = message.slice(0, 300);
      execFileSync('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        __dirname + '/toast.ps1',
      ], {
        env: { ...process.env, TOAST_TITLE: '⚠️ もちwhat 监控异常', TOAST_MESSAGE: msg },
        stdio: 'ignore',
        timeout: 10000,
      });
      console.log('[✓] 已发送异常桌面通知');
    } catch (e) { console.error('[!] 异常桌面通知失败:', e.message); }
  }

  if (process.env.SCT_KEY) {
    try {
      const resp = await fetch(`https://sctapi.ftqq.com/${process.env.SCT_KEY}.send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title: '⚠️ もちwhat 监控异常', desp: message }),
        signal: AbortSignal.timeout(10000),
      });
      const result = await resp.json();
      if (result.code === 0) console.log('[✓] 已发送异常微信通知');
      else console.error('[!] 异常微信通知失败:', JSON.stringify(result));
    } catch (e) { console.error('[!] 异常微信通知失败:', e.message); }
  }
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
    const delivered = await notify([latest]);
    if (delivered) {
      seen.add(latest.url); // 通知成功才记录;失败则下次重试
      saveSeen(seen);
      console.log('[*] 通知成功,已记录去重');
    } else {
      console.log('[*] 所有通知渠道失败,不记录去重,下轮重试');
      // 全部通知渠道失败属于监控故障:单次模式(CI)下以非零退出码暴露
      if (!process.argv.includes('--loop')) process.exitCode = 1;
    }
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
    const raw = parseInt(args[idx + 1], 10);
    // 校验:正数且 ≤ 1440(24h)。负/NaN/超大回退默认。
    // 极大值会超出 setTimeout 上限(约 24.8 天),被压缩为 ~1ms 连续请求。
    const minutes = Number.isFinite(raw) && raw >= 1 && raw <= 1440 ? raw : CONFIG.loopMinutes;
    console.log(`[*] 循环模式:每 ${minutes} 分钟检查一次`);
    let consecutiveFailures = 0; // 连续失败计数(可靠性告警)
    while (true) {
      rotateLog(); // 每次循环前检查日志大小
      try {
        await runOnce();
        consecutiveFailures = 0; // 成功即重置
      } catch (e) {
        consecutiveFailures++;
        console.error(`[!] 本次抓取失败(连续 ${consecutiveFailures} 次):`, e.message);
        // 连续失败 ≥ 3 次推送告警(限频 30 分钟),避免静默故障
        if (consecutiveFailures >= 3) {
          await sendAlert(`监控连续 ${consecutiveFailures} 次抓取失败,请检查代理/网络。\n最近错误:${e.message}`);
        }
      }
      await new Promise((r) => setTimeout(r, minutes * 60 * 1000));
    }
  } else {
    // 单次模式(如 CI):失败也发告警,便于发现静默故障
    try {
      await runOnce();
    } catch (e) {
      console.error('[!] 抓取失败:', e.message);
      await sendAlert(`监控抓取失败:\n${e.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
