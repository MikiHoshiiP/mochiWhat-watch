# もちwhat Mercari 低价监控

自动监控 Mercari(メルカリ)上「もちwhat」的最新商品,当出现价格低于阈值(默认 100,000 日元)的新商品时,发送 Windows 桌面通知。

## 工作原理

```
┌──────────┐  代理(Clash)   ┌─────────────────────────┐  抓取   ┌──────────────┐
│ 本机脚本  │ ────────────→ │ jp.mercari.com 搜索页    │ ────→  │ 商品列表      │
│          │  127.0.0.1:7897│ (headless Edge 渲染)    │         │ 价格/标题/链接 │
└──────────┘                └─────────────────────────┘         └──────┬───────┘
                                                                        │ 筛选
                                                          ┌─────────────▼──────┐
                                                          │ ① 新着順(最新优先) │
                                                          │ ② 标题含「もちwhat」│
                                                          │ ③ 在售(非売り切れ)  │
                                                          │ ④ 价格 < 100,000 円 │
                                                          │ ⑤ 未通知过(去重)    │
                                                          └─────────────┬──────┘
                                                                        ▼
                                                             Windows 桌面通知 / 日志
```

> 注:Mercari 需要真实浏览器渲染才能拿到商品数据(页面为客户端渲染 + Cloudflare 防护),因此使用 Playwright 无头浏览器;同时国内直连不通,必须走本地代理。

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
| `node mercari-watch.js --loop 10` | 每 10 分钟检查一次(数字可改) |
| `npm run watch` | 单次检查 |
| `npm run watch:loop` | 每 10 分钟循环 |
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
  loopMinutes: 10,             // 循环间隔(分钟)
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
node mercari-watch.js --loop 10

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
├── toast.ps1          # Windows 桌面通知(PowerShell)
├── watch.bat          # 循环启动脚本(每 10 分钟)
├── package.json       # 依赖(playwright)
├── seen.json          # 已通知商品记录(自动生成,勿手动编辑)
└── watch.log          # 运行日志(自动生成)
```

## 常见问题

**Q: 运行报错 `Executable doesn't exist`**
A: 缺少无头浏览器,执行 `npx playwright install chromium-headless-shell`。

**Q: 抓取 0 件商品**
A: 检查代理是否开启、`CONFIG.proxy` 端口是否与 Clash 一致。

**Q: 想重新收到某件商品的提醒**
A: 删除 `seen.json`,下次运行会重新通知所有当前低价商品。

**Q: 会重复通知同一商品吗**
A: 不会。每个商品 URL 记录在 `seen.json`,仅首次出现时通知(原子写入,防止崩溃损坏)。

**Q: 监控频率可以更快吗**
A: 可以,改 `--loop` 后的分钟数或 `CONFIG.loopMinutes`。注意:过高的抓取频率可能触发 Mercari 风控,当前 10 分钟间隔适中,建议不要低于 5 分钟。

## 免责声明

本工具仅供个人学习使用。请遵守 Mercari 的服务条款,控制抓取频率,不用于商业用途。
