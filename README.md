# もちWhat! Mercari 低价监控

自动监控 Mercari(メルカリ)上「もちwhat」的**最新上架商品**:只检查新着顺第一件,当其**价格严格低于匹配阈值**时,推送微信「服务通知」。默认阈值为 100,000 日元;标题同时包含「もちwhat」和特例名称时,使用对应的专属阈值。同一商品只通知一次。

支持三种运行方式:**GitHub Actions 云端定时**(推荐,关机也持续)、**Linux 服务器 / Docker** 与**本机循环**。

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
                                                          │ ④ 价格 < 匹配阈值 │
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
   - `*/3 * * * *` 每 3 分钟自动运行(实际间隔约 5~8 分钟,受平台调度延迟影响;可改 cron)
   - 手动触发:**Actions → Mercari Watch → Run workflow**
   - 去重状态 `seen.json` 自动 commit 回仓库,跨 run 持续

### 常见问题(云端)

- **Forbidden(403)**:GitHub 数据中心 IP 访问 API 被风控,属预期——脚本自动回退浏览器抓取,无需处理
- **Actions 未显示 workflow**:在仓库 Actions 页面启用,或空提交推送强制扫描

## 方式二:Linux 服务器 / Docker

适合有自己的 Linux 服务器(海外 VPS 直连 Mercari,无需代理)。

### 直接运行(源码)

```bash
git clone https://github.com/MikiHoshiiP/mochiWhat-watch.git
cd mochiWhat-watch
npm install

# 海外服务器:PROXY=direct 直连,1 分钟轮询
PROXY=direct SCT_KEY=你的SendKey node mercari-watch.js --loop 1
```

### systemd 服务(服务器上常驻,开机自启)

```bash
bash deploy-linux.sh
# 交互式输入 SendKey → 自动注册服务并启动
```

管理命令:

```bash
sudo journalctl -u mercari-watch -f   # 日志
sudo systemctl restart mercari-watch  # 重启
```

### Docker(容器内运行,无需 systemd)

```bash
docker build -t mochi-watch .
docker run -d --name mochi-watch --restart=always \
  -e SCT_KEY=你的SendKey -e PROXY=direct \
  -v mochi-data:/app mochi-watch
# 或 docker compose up -d(需先 export SCT_KEY=你的SendKey)
```

> 容器内没有 systemd,`systemctl` 不可用属正常。崩溃重启由 Docker 的 `--restart=always` 承担,数据(seen.json/dpop.json/watch.log)挂载在 `/app` 卷持久化。

### 前台窗口与进程的关系(重要)

- `docker run -tid` 分离模式创建容器后,**容器不依赖窗口**;关掉 SSH/终端,容器照常运行
- 容器内 `docker exec -it` 进去**前台跑**的进程,会随窗口关闭而终止
- 要脱离窗口常驻:用 `docker exec -d` 分离执行,或直接用上面的 `docker run -d`(推荐)
- 进程随容器重启而消失,`--restart=always` 可让容器崩溃后自动重启

## 方式三:本机运行(Windows)

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
  priceLimit: 100000,          // 默认低价阈值(日元)
  specialPriceLimits: {        // 标题命中时覆盖默认阈值
    '櫻木真乃': 120000,
    '風野灯織': 150000,
    '八宮めぐる': 120000,
    '幽谷霧子': 150000,
    '園田智代子': 120000,
    '杜野凛世': 150000,
    '黛冬優子': 70000,
  },
  proxy: 'http://127.0.0.1:7897', // 本地代理(未设置时默认)
  timeout: 60000,              // 页面加载超时(ms)
  stateFile: __dirname + '/seen.json',  // 已通知商品记录
  loopMinutes: 1,              // 循环间隔(分钟)
};
```

价格阈值规则:

| 商品标题中的特例名称 | 通知条件 |
|---|---:|
| 櫻木真乃 | 价格 < 120,000 日元 |
| 風野灯織 | 价格 < 150,000 日元 |
| 八宮めぐる | 价格 < 120,000 日元 |
| 幽谷霧子 | 价格 < 150,000 日元 |
| 園田智代子 | 价格 < 120,000 日元 |
| 杜野凛世 | 价格 < 150,000 日元 |
| 黛冬優子 | 价格 < 70,000 日元 |
| 未命中特例 | 价格 < 100,000 日元 |

只检查当前最新上架的一件商品。如标题意外命中多个特例名称,使用其中最低的阈值。

环境变量:

| 变量 | 用途 |
|---|---|
| `PROXY` | 代理地址;`direct` = 不走代理(GitHub Actions / 海外服务器直连) |
| `SCT_KEY` | Server酱 SendKey,设置后推送微信「服务通知」 |
| `DPOP` | Mercari API 令牌(CI 从 Secret 注入;本机默认读 `dpop.json`) |
| `BROWSER_CHANNEL` | 浏览器通道,覆盖默认选择:`msedge` / `chrome` / `chromium`。默认自动:Windows→系统 Edge,其他→系统 Chrome;系统浏览器缺失时自动回退 Playwright 自带 chromium(如精简服务器/容器) |
| `WECOM_WEBHOOK` | 企业微信群机器人 webhook(可选) |
| `QQ_WEBHOOK` | QQ 机器人(NapCat OneBot)HTTP 端点,如 `http://127.0.0.1:3000/send_private_msg` |
| `QQ_TOKEN` | NapCat 的 access token(如配置了认证) |
| `QQ_USER_ID` | 接收通知的 QQ 号 |

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
| QQ 机器人(NapCat) | 可选,设置 `QQ_WEBHOOK` + `QQ_TOKEN` + `QQ_USER_ID` 后启用,低价商品推送 QQ 私聊 |
| Windows 桌面通知 | 仅本机(Windows),低价商品右下角 toast |
| 企业微信机器人 | 可选,设置 `WECOM_WEBHOOK` 后启用 |
| 控制台 / `watch.log` | 每次运行输出统计与低价列表 |

> 全部通知渠道失败时,商品不会被标记为已通知(下轮重试),并以非零退出码暴露(CI 会显示红色)。

## QQ 机器人接入

用 [NapCatQQ](https://napcat.napneko.icu)(OneBot v11 实现)用小号登录常驻,启用 **HTTP 服务器**(默认 `127.0.0.1:3000`),然后设置环境变量:

```bash
export QQ_WEBHOOK=http://127.0.0.1:3000/send_private_msg
export QQ_TOKEN=你的NapCatToken        # 如配置了认证
export QQ_USER_ID=接收消息的QQ号
```

设置后,低价商品和监控异常都会推送 QQ 私聊(中文 UTF-8,无乱码)。微信推送可同时保留。

## 项目结构

```
mochi/
├── mercari-watch.js       # 主程序:抓取(API/浏览器回退) → 筛选 → 去重 → 通知
├── mercari-api.js         # API 直连模块(dpop 令牌、分页、在售过滤、错误识别)
├── toast.ps1              # Windows 桌面通知(PowerShell,仅本机)
├── watch.bat.example      # 本机循环启动脚本模板(复制为 watch.bat 使用)
├── gen-dpop.js            # 生成/轮换 dpop 令牌(写入 dpop.json,可配 Secret)
├── deploy-linux.sh        # Linux systemd 一键部署脚本
├── Dockerfile             # Docker 镜像(容器内前台运行,restart policy 守护)
├── docker-compose.yml     # Docker Compose 编排
├── .github/workflows/watch.yml  # GitHub Actions 定时(每 3 分钟)
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
