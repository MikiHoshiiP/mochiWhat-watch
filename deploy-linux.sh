#!/usr/bin/env bash
# Mercari もちwhat 监控 - Linux 部署脚本(服务器上执行)
# 用法: bash deploy-linux.sh
set -euo pipefail

APP_DIR="${1:-$HOME/mochiWhat-watch}"
SERVICE_NAME="mercari-watch"

echo "==> 1/4 检查 Node.js"
if ! command -v node >/dev/null; then
  echo "未安装 Node.js,安装中..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo "Node: $(node --version)"

echo "==> 2/4 获取代码(如未 clone)"
if [ ! -f "$APP_DIR/package.json" ]; then
  git clone https://github.com/MikiHoshiiP/mochiWhat-watch.git "$APP_DIR"
fi
cd "$APP_DIR"
npm install

echo "==> 3/4 配置环境"
# 提示设置 SCT_KEY(微信推送)
if ! grep -q "SCT_KEY" "$APP_DIR/mercari-watch.service" 2>/dev/null; then
  read -rp "请输入 Server酱 SendKey(留空跳过): " SCT
fi

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
