#!/usr/bin/env bash
# Mercari もちwhat 监控 - Linux 部署脚本(Ubuntu,服务器上执行)
# 前提:代码已获取到本机(如 git clone 或 scp),脚本在项目根目录下运行。
# 用法: bash deploy-linux.sh [项目目录]
set -euo pipefail

APP_DIR="${1:-$(pwd)}"
SERVICE_NAME="mercari-watch"

echo "==> 0/4 校验代码目录"
if [ ! -f "$APP_DIR/package.json" ] || [ ! -f "$APP_DIR/mercari-watch.js" ]; then
  echo "✗ $APP_DIR 下未找到项目代码。请先获取代码:"
  echo "    git clone https://github.com/MikiHoshiiP/mochiWhat-watch.git && cd mochiWhat-watch"
  echo "  然后重新运行本脚本。"
  exit 1
fi

echo "==> 1/4 检查 Node.js"
if ! command -v node >/dev/null; then
  echo "未安装 Node.js,安装中..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo "Node: $(node --version)"

echo "==> 2/4 安装依赖"
cd "$APP_DIR"
npm install

echo "==> 3/4 配置环境"
read -rp "请输入 Server酱 SendKey(微信推送,留空跳过): " SCT
read -rp "NapCat HTTP 地址(如 http://127.0.0.1:3000/send_group_msg,留空禁用 QQ): " QQWB
read -rp "NapCat Token(留空则无): " QQTK
read -rp "QQ 群号(留空则无): " QQGID

cat > mercari-watch.service <<EOF
[Unit]
Description=Mercari もちwhat low-price watcher
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node mercari-watch.js --loop 1
Restart=always
RestartSec=10
Environment=PROXY=direct
Environment=SCT_KEY=${SCT:-}
Environment=BROWSER_CHANNEL=chromium
Environment=QQ_WEBHOOK=${QQWB:-}
Environment=QQ_TOKEN=${QQTK:-}
Environment=QQ_GROUP_ID=${QQGID:-}

[Install]
WantedBy=multi-user.target
EOF

echo "==> 4/4 注册 systemd 服务并启动"
sudo cp mercari-watch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "✅ 部署完成"
echo "   查看日志: sudo journalctl -u $SERVICE_NAME -f"
echo "   状态:     sudo systemctl status $SERVICE_NAME"
echo "   重启:     sudo systemctl restart $SERVICE_NAME"
echo "   停止:     sudo systemctl stop $SERVICE_NAME"
