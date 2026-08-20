# Mercari もちwhat 低价监控 - Docker 镜像
# 构建: docker build -t mochi-watch .
# 运行: docker run -d --name mochi-watch --restart=always \
#          -e SCT_KEY=你的SendKey -e PROXY=direct \
#          -v mochi-data:/app mochi-watch
# 注意:容器 PID 1 是 node(前台运行);崩溃重启由 Docker restart policy 负责,
#       无需 systemd(容器内不可用)。

FROM node:20-slim

WORKDIR /app

# 先装依赖(利用 Docker 层缓存)
COPY package.json package-lock.json ./
RUN npm install

# Playwright chromium(浏览器回退/dpop 刷新备用;curl 直连通时用不到)
# slim 镜像需 apt 依赖,--with-deps 自动处理
RUN npx playwright install --with-deps chromium

# 代码
COPY mercari-watch.js mercari-api.js ./

# 整个 /app 挂为卷:去重 seen.json、dpop 令牌、watch.log 全部持久化
VOLUME ["/app"]

ENV PROXY=direct
ENV HOME=/app

# 前台运行(容器主进程),1 分钟轮询
CMD ["node", "mercari-watch.js", "--loop", "1"]
