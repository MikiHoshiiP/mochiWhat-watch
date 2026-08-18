# もちwhat Mercari 低价监控

自动监控 Mercari(メルカリ)上「もちwhat」的**最新上架商品**:当最新商品的**价格低于阈值**(默认 100,000 日元)时,发送 Windows 桌面通知 + 微信推送。同一商品只通知一次;未通知过的高价商品持续评估(降价后自动触发)。

## 工作原理

```
┌──────────┐  代理(Clash)   ┌─────────────────────────┐  直连   ┌──────────────┐
│ 本机脚本  │ ────────────→ │ api.mercari.jp 搜索 API  │ ────→  │ 商品列表      │
│          │  127.0.0.1:7897│ (JSON,约 0.5~1 秒/次)   │         │ 价格/标题/链接 │
└──────────┘                └─────────────────────────┘         └──────┬───────┘
                                                                        │ 筛选
                                                          ┌─────────────▼──────┐
                                                          │ ① 新着順(最新优先) │
                                                          │ ② 标题含「もちwhat」│
                                                          │ ③ 只看最新上架的一件 │
                                                          │ ④ 价格 < 100,000 円 │
                                                          │ ⑤ 同一商品只通知一次 │
                                                          └─────────────┬──────┘
                                                                        ▼
                                            Windows 桌面通知 + 微信(Server酱)/ 日志
```

> 直接调用 Mercari 搜索 API(`api.mercari.jp/v2/entities:search`),单次约 0.5~1 秒、可拿全量商品,比浏览器渲染(约 25 秒、仅首屏)快一个数量级。API 需携带 `dpop` 令牌,由 `node get-dpop.js` 从浏览器会话捕获(已生成 `dpop.json`,令牌可长期复用;若失效重新捕获即可)。API 不可用时自动回退浏览器模式。

## 快速开始

### 环境要求

- Node.js 18+
- 本地代理软件(Clash 等),默认端口 `7897`

### 安装

```bash
cd D:\Code\mochi
npm install
npx playwright install chromium-headless-shell
```

### 使用

| 命令 | 说明 |
|---|---|
| `node mercari-watch.js` | 单次检查(调试用) |
| `node mercari-watch.js --loop 1` | 每 1 分钟检查一次(数字可改) |
| `npm run watch` | 单次检查 |
| `npm run watch:loop` | 每 1 分钟循环 |
| `watch.bat` | 循环运行,日志写入 `watch.log`(推荐) |

### 开机自动运行(已配置)

`watch.bat` 已复制到 Windows 启动文件夹(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MercariWatch.bat`),登录后自动开始监控。取消自启:删除该文件即可。

## 配置

所有参数在 [mercari-watch.js](mercari-watch.js) 顶部的 `CONFIG` 中:

```js
const CONFIG = {
  keyword: 'もちwhat',        // 搜索关键词
  priceLimit: 100000,          // 低价阈值(日元)
  proxy: 'http://127.0.0.1:7897', // 本地代理地址(连 Mercari 必需)
  timeout: 60000,              // 页面加载超时(ms)
  stateFile: __dirname + '/seen.json',  // 已通知商品记录
  loopMinutes: 1,              // 循环间隔(分钟),API 模式建议 1~5
};
```

环境变量(可选):

| 变量 | 用途 |
|---|---|
| `PROXY` | 覆盖代理地址 |
| `BROWSER_CHANNEL` | 浏览器通道:`msedge` / `chrome`(默认 Playwright 自带 Chromium) |
| `SCT_KEY` | Server酱 SendKey,设置后低价商品推送微信「服务通知」 |
| `WECOM_WEBHOOK` | 企业微信群机器人 webhook,设置后低价商品同时推送企业微信 |

## 手机推送(微信)

推荐 **Server酱**(免费、个人可用):在 [sct.ftqq.com](https://sct.ftqq.com) 用 GitHub 登录,获取 SendKey,然后:

```bash
# 方式一:环境变量(临时)
set SCT_KEY=你的SendKey
node mercari-watch.js --loop 1

# 方式二:写入 watch.bat(开机自启也生效)
#   编辑 watch.bat,把 SCT_KEY=你的SendKey 替换成真实 SendKey
```

设置后,抓到低价商品会同时弹桌面通知 + 推送微信「服务通知」。

## 通知渠道

| 渠道 | 默认 | 说明 |
|---|---|---|
| Windows 桌面通知 | ✅ | 新低价商品出现时右下角 toast |
| Server酱 → 微信 | ❌ | 设置 `SCT_KEY` 后启用,推送微信「服务通知」 |
| 企业微信机器人 | ❌ | 设置 `WECOM_WEBHOOK` 后启用,推送完整列表 |
| 控制台 / `watch.log` | ✅ | 每次运行输出抓取统计与低价列表 |

## 项目结构

```
mochi/
├── mercari-watch.js   # 主程序:抓取 → 筛选 → 去重 → 通知
├── mercari-api.js     # API 直连模块(dpop 令牌、分页、在售过滤)
├── toast.ps1          # Windows 桌面通知(PowerShell)
├── watch.bat          # 循环启动脚本(每 1 分钟)
├── package.json       # 依赖(playwright)
├── dpop.json          # API 令牌(自动生成,勿手动编辑;gitignore)
├── seen.json          # 已通知商品记录(自动生成,勿手动编辑)
└── watch.log          # 运行日志(自动生成)
```

## 常见问题

**Q: 运行报错 `Executable doesn't exist`**
A: 缺少无头浏览器,执行 `npx playwright install chromium-headless-shell`。仅浏览器回退模式需要,API 模式无需浏览器。

**Q: API 返回 401 / 抓取失败(回退浏览器)**
A: `dpop` 令牌失效。执行 `node get-dpop.js` 重新捕获令牌(会生成新的 `dpop.json`)。

**Q: 抓取 0 件商品**
A: 检查代理是否开启、`CONFIG.proxy` 端口是否与 Clash 一致。

**Q: 想重新收到某件商品的提醒**
A: 删除 `seen.json`,下次运行会重新通知所有当前低价商品。

**Q: 会重复通知同一商品吗**
A: 不会。每个商品 URL 记录在 `seen.json`,仅首次出现时通知(原子写入,防止崩溃损坏)。

**Q: 监控频率可以更快吗**
A: API 模式单次约 1 秒,当前默认 1 分钟轮询,已接近实时。不建议低于 1 分钟(可能触发 Mercari 风控)。浏览器模式较慢(约 25 秒),只作为 API 失效时的回退。

## 免责声明

本工具仅供个人学习使用。请遵守 Mercari 的服务条款,控制抓取频率,不用于商业用途。
