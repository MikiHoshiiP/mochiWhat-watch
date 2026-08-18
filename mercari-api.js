/**
 * Mercari 搜索 API 直连模块
 *
 * 原理:页面 jp.mercari.com/search 会向后端 API 发 POST
 *   https://api.mercari.jp/v2/entities:search
 * 带上 dpop(DPoP JWT) 令牌即可直接调用,无需启动浏览器。
 * 单次请求约 0.5~1 秒,可拿全量商品(浏览器只渲染首屏)。
 *
 * dpop 令牌由浏览器会话捕获(脚本自动刷新),存于 dpop.json。
 * 令牌复用有效(实测连续调用无限制),若失效返回 401 则自动重新捕获。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DPOP_FILE = path.join(__dirname, 'dpop.json');
// 代理:未设置时默认本地 Clash(127.0.0.1:7897);
// 设为 'direct' 时不走代理(如 GitHub Actions / 海外服务器直连)
const PROXY = process.env.PROXY === 'direct' ? null : (process.env.PROXY || 'http://127.0.0.1:7897');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function loadDpop() {
  // Secret 注入优先(CI 环境);否则读本地 dpop.json(开发机)
  if (process.env.DPOP) return process.env.DPOP;
  try { return JSON.parse(fs.readFileSync(DPOP_FILE, 'utf8')).dpop; } catch { return null; }
}

/**
 * 直连搜索 API。
 * @param {string} keyword 搜索关键词
 * @param {object} opts { sort: 'SORT_CREATED_TIME'|'SORT_SCORE', pageSize, pageToken, maxPages }
 * @returns {Promise<Array>} 商品数组 [{ id, title, name, price, status, created, url }]
 */
async function searchViaApi(keyword, opts = {}) {
  const {
    sort = 'SORT_CREATED_TIME',        // 新着順
    pageSize = 120,
    pageToken = '',
    maxPages = 3,
  } = opts;
  const dpop = loadDpop();
  if (!dpop) throw new Error('dpop.json 缺失,请运行监控脚本自动捕获令牌');

  const payload = {
    userId: '',
    config: { responseToggles: ['QUERY_SUGGESTION_WEB_1'] },
    pageSize, pageToken,
    searchSessionId: 'watch-' + Date.now(),
    source: 'BaseSerp',
    indexRouting: 'INDEX_ROUTING_UNSPECIFIED',
    thumbnailTypes: [],
    searchCondition: {
      keyword, excludeKeyword: '', sort, order: 'ORDER_DESC',
      status: ['STATUS_ON_SALE'],   // 只在售(实测有效枚举值)
      sizeId: [], categoryId: [], brandId: [], sellerId: [],
      priceMin: 0, priceMax: 0, itemConditionId: [], shippingPayerId: [],
      shippingFromArea: [], shippingMethod: [], colorId: [], hasCoupon: false,
      attributes: [], itemTypes: [], skuIds: [], shopIds: [], excludeShippingMethodIds: [],
    },
    serviceFrom: 'suruga', withItemBrand: true, withItemSize: false,
    withItemPromotions: true, withItemSizes: true, withShopname: false,
    useDynamicAttribute: true, withSuggestedItems: true, withOfferPricePromotion: true,
    withProductSuggest: true, withParentProducts: false, withProductArticles: true,
    withSearchConditionId: false, withAuction: true,
    laplaceDeviceUuid: '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14), // 随机 UUID
  };

  const tmp = path.join(require('os').tmpdir(), 'mercari-api-' + process.pid + '.json');
  const all = [];
  let token = pageToken;

  for (let page = 0; page < maxPages; page++) {
    payload.pageToken = token;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    try {
      const args = [
        '-s', '-m', '20', '-X', 'POST',
        'https://api.mercari.jp/v2/entities:search',
        '-H', 'Content-Type: application/json',
        '-H', 'x-platform: web',
        '-H', 'referer: https://jp.mercari.com/',
        '-H', 'accept-language: ja',
        '-H', 'x-country-code: JP',
        '-H', 'dpop: ' + dpop,
        '-H', 'user-agent: ' + UA,
        '-H', 'accept: application/json, text/plain, */*',
        '--data-binary', '@' + tmp,
      ];
      if (PROXY) args.splice(1, 0, '-x', PROXY); // 有代理才传 -x(直连模式不传)
      const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      const json = JSON.parse(out);
      // 识别错误响应(401/403 等):curl 无 --fail 时错误响应仍以退出码 0 返回
      if (!json.items || json.code) {
        const msg = json.message || json.error || JSON.stringify(json).slice(0, 200);
        if (json.code === 16) throw new Error('dpop 令牌失效(401),需刷新令牌: ' + msg);
        if (json.code === 7) throw new Error('API 权限不足(403): ' + msg);
        throw new Error('API 错误响应: ' + msg);
      }
      const items = json.items || [];
      all.push(...items);
      token = json.meta?.nextPageToken || '';
      if (!token || items.length === 0) break;
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw new Error('API 调用失败(第 ' + (page + 1) + ' 页): ' + e.message);
    }
  }
  fs.rmSync(tmp, { force: true });

  return all.map((it) => ({
    id: it.id,
    title: it.name || '',
    name: it.name || '',
    price: parseInt(it.price, 10) || 0,
    status: it.status || '',
    created: it.created ? parseInt(it.created, 10) : 0,
    url: 'https://jp.mercari.com/item/' + it.id,
  }));
}

module.exports = { searchViaApi };
