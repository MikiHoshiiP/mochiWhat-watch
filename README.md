# もちwhat Mercari 低价监控

自动监控 Mercari(メルカリ)上「もちwhat」的**最新上架商品**:当最新商品的**价格低于阈值**(默认 100,000 日元)时,推送微信「服务通知」。同一商品只通知一次;未通知过的高价商品持续评估(降价后自动触发)。

支持两种运行方式:**GitHub Actions 云端定时**(推荐,关机也持续)与**本机循环**。

## 工作原理

```
┌──────────────┐            ┌─────────────────────────┐   抓取   ┌──────────────┐
│ GitHub Actions│  定时调度  │ Mercari 搜索 API / 页面   │ ────→  │ 商品列表      │
│ (每5分钟,云端) │ ────────→ │ api.mercari.jp           │         │ 价格/标题/链接 │
│ 或本机(每1分钟)│            └─────────────────────────┘         └──────┬───────┘
└──────────────┘                                                       │ 筛选
                                                          ┌─────────────▼──────┐
                                                          │ ① 新着順(最新优先) │
                                                          │ ② 标题含「もちwhat」│
                                                          │ ③ 只看最新上架的一件 │
                                                          │ ④ 价格 < 100,000 円 │
                                                          │ ⑤ 同一商品只通知一次 │
                                                          └─────────────┬──────┘
                                                                        ▼
                                                   Server酱 → 微信「服务通知」
```

**抓取双通道(自动回退)**:
1. **API 直连**(curl POST `api.mercari.jp/v2/entities:search`,约 0.5~1 秒,带 `dpop` 令牌)——本机首选
2. **浏览器抓取**(Playwright 打开搜索页,拦截页面 API 响应)——curl 被风控(403,如 GitHub 数据中心 IP)时自动回退

## 方式一:GitHub Actions 云端(推荐)

无需本机运行、无需代理,电脑关机也持续监控。

### 配置(一次性)

1. Fork / 推送本仓库到 GitHub(公开仓库免费无限 Actions 分钟)
2. 配置 Secrets(仓库 **Settings → Secrets and variables → Actions**):

| Name | Value |
|---|---|
| `SCT_KEY` | Server酱 SendKey(见下文「微信推送」) |
| `DPOP` | Mercari API 令牌,运行 `node gen-dpop.js` 或从本机 `dpop.json` 获取 |

3. Workflow [.github/workflows/watch.yml](.github/workflows/watch.yml) 已配置:
   - `*/5 * * * *` 每 5 分钟自动运行(可改 cron)
   - 手动触发:**Actions → Mercari Watch → Run workflow**
   - 去重状态 `seen.json` 自动 commit 回仓库,跨 run 持续

### 常见问题(云端)

- **Forbidden(403)**:GitHub 数据中心 IP 访问 API 被风控,属预期——脚本自动回退浏览器抓取,无需处理
- **Actions 未显示 workflow**:在仓库 Actions 页面启用,或空提交推送强制扫描

## 方式二:本机运行

### 环境要求

- Node.js 18+
- 本地代理软件(Clash 等),默认端口 `7897`(国内直连 Mercari 不通)

### 安装与使用

```bash
git clone <仓库地址>
cd mochi
npm install

node mercari-watch.js            # 单次检查
node mercari-watch.js --loop 1   # 每 1 分钟循环(默认走 API 直连)
npm run watch:loop               # 同上
```

### 开机自动运行(Windows)

```bash
copy watch.bat.example watch.bat
# 编辑 watch.bat,把 SCT_KEY=你的SendKey 替换为真实 SendKey
# 然后复制到启动文件夹:
copy watch.bat "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MercariWatch.bat"
```

## 配置

主参数在 [mercari-watch.js](mercari-watch.js) 顶部的 `CONFIG`:

```js
const CONFIG = {
  keyword: 'もちwhat',        // 搜索关键词
  priceLimit: 100000,          // 低价阈值(日元)
  proxy: 'http://127.0.0.1:7897', // 本地代理(未设置时默认)
  timeout: 60000,              // 页面加载超时(ms)
  stateFile: __dirname + '/seen.json',  // 已通知商品记录
  loopMinutes: 1,              // 循环间隔(分钟)
};
```

环境变量:

| 变量 | 用途 |
|---|---|
| `PROXY` | 代理地址;`direct` = 不走代理(GitHub Actions / 海外服务器直连) |
| `SCT_KEY` | Server酱 SendKey,设置后推送微信「服务通知」 |
| `DPOP` | Mercari API 令牌(CI 从 Secret 注入;本机默认读 `dpop.json`) |
| `BROWSER_CHANNEL` | 浏览器通道:`msedge` / `chrome`(默认 Playwright 自带 Chromium) |
| `WECOM_WEBHOOK` | 企业微信群机器人 webhook(可选) |

## 微信推送

推荐 **Server酱**(免费、个人可用):在 [sct.ftqq.com](https://sct.ftqq.com) 用 GitHub 登录,获取 SendKey,然后:

```bash
# 本机:环境变量(临时)
set SCT_KEY=你的SendKey
node mercari-watch.js --loop 1

# 本机:写入启动脚本(开机自启也生效)
#   编辑 watch.bat(由 watch.bat.example 复制而来),替换 SCT_KEY=你的SendKey

# GitHub:配置到仓库 Secret(SCT_KEY),见上文
```

设置后,抓到低价商品推送微信「服务通知」。

## 通知渠道

| 渠道 | 说明 |
|---|---|
| Server酱 → 微信 | 主要渠道(云端与本机共用),低价商品推送微信「服务通知」 |
| Windows 桌面通知 | 仅本机(Windows),低价商品右下角 toast |
| 企业微信机器人 | 可选,设置 `WECOM_WEBHOOK` 后启用 |
| 控制台 / `watch.log` | 每次运行输出统计与低价列表 |

> 全部通知渠道失败时,商品不会被标记为已通知(下轮重试),并以非零退出码暴露(CI 会显示红色)。

## 项目结构

```
mochi/
├── mercari-watch.js       # 主程序:抓取(API/浏览器回退) → 筛选 → 去重 → 通知
├── mercari-api.js         # API 直连模块(dpop 令牌、分页、在售过滤、错误识别)
├── toast.ps1              # Windows 桌面通知(PowerShell,仅本机)
├── watch.bat.example      # 本机循环启动脚本模板(复制为 watch.bat 使用)
├── .github/workflows/watch.yml  # GitHub Actions 定时(每 5 分钟)
├── package.json           # 依赖(playwright)
├── dpop.json              # API 令牌(自动生成,勿手动编辑;gitignore,CI 用 Secret)
└── seen.json              # 已通知商品记录(自动生成;云端自动 commit 持久化)
```

## 常见问题

**Q: 会重复通知同一商品吗**
A: 不会。每个商品 URL 记录在 `seen.json`,仅首次出现时通知(原子写入)。**注意**:本机与 GitHub 云端各自维护一份 seen.json,若两处同时运行,同一商品可能各推一次(间隔 ≤5 分钟);只用云端即可完全避免。

**Q: 抓取 0 件商品 / 全部失败**
A: 本机:检查代理是否开启、`PROXY` 端口是否与 Clash 一致。云端:curl 403 属预期(自动回退浏览器),连续失败会发告警微信。

**Q: 想重新收到某件商品的提醒**
A: 删除 `seen.json`(本机)或删掉仓库里已提交的 `seen.json`(云端),下次运行会重新通知当前低价商品。

**Q: 监控频率可以更快吗**
A: 本机 API 模式单次约 1 秒,默认 1 分钟;GitHub 调度下限 5 分钟。不建议更低(风控)。

**Q: dpop 令牌失效(401)**
A: 脚本自动用 Playwright 打开搜索页捕获新令牌并重试,无需手动。本机:写入 `dpop.json`;云端:仅当轮生效,需重新生成令牌并更新 Secret。

## 免责声明

本工具仅供个人学习使用。请遵守 Mercari 的服务条款,控制抓取频率,不用于商业用途。
