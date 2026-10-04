#!/usr/bin/env bash
# simvowifi 安装脚本 —— Debian / Ubuntu / Armbian (amd64 / arm64)
#
# 用法:  sudo ./install.sh            # 完整安装（含构建 engine 镜像）
#        sudo SKIP_BUILD=1 ./install.sh   # 跳过镜像构建（之后手动 simvowifi build）
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

say()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "请用 root 运行: sudo ./install.sh"
command -v apt-get >/dev/null || die "本脚本支持 Debian/Ubuntu/Armbian（其他发行版请参考 docs/SETUP.md 手动安装）"

say "1/6 · 系统依赖（pcscd 读卡服务、Python venv、OpenSSL）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq pcscd pcsc-tools python3-venv python3-pip python3-pyscard \
                     python3-yaml openssl ca-certificates curl >/dev/null
systemctl enable --now pcscd 2>/dev/null || true
ok "pcscd 已安装并启动"

say "2/6 · Docker"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    ok "Docker 已就绪: $(docker --version | cut -d, -f1)"
else
    say "安装 Docker（get.docker.com）…"
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
    ok "Docker 安装完成"
fi

say "3/6 · 控制面 venv（复用系统 pyscard）"
if [ ! -x .venv/bin/python ]; then
    python3 -m venv --system-site-packages .venv
fi
# PyYAML 走系统包（已装）；requirements 里 pyscard 由系统包提供，仅做声明
.venv/bin/pip install --quiet --disable-pip-version-check PyYAML 2>/dev/null \
  || warn "pip 安装 PyYAML 失败（系统包可能已可用，继续）"
ok ".venv 就绪"

say "4/6 · CLI 命令 /usr/local/bin/simvowifi"
install -m 0755 bin/simvowifi /usr/local/bin/simvowifi
ok "simvowifi 命令可用"

say "5/6 · 检查 /dev/net/tun"
[ -e /dev/net/tun ] && ok "/dev/net/tun 存在" || warn "/dev/net/tun 不存在（ePDG 隧道必需，容器宿主机一般自带）"

if [ "${SKIP_BUILD:-0}" = "1" ]; then
    warn "跳过镜像构建 → 之后运行: simvowifi build"
else
    say "6/6 · 构建 engine 镜像（编译 Asterisk，约 10-20 分钟）"
    if docker build -t simvowifi/engine:latest engine/ ; then
        ok "engine 镜像构建完成"
    else
        warn "镜像构建失败 —— 可稍后重试: simvowifi build"
    fi
fi

echo
ok "安装完成！后续步骤:"
cat <<'EOF'
  1. simvowifi init              # 初始化配置（生成 data/config.yaml）
  2. 编辑 data/config.yaml       # 填 bark.key（Bark App 复制）、line.pin 等
  3. 插入 USB 读卡器 + SIM
  4. simvowifi doctor            # 环境体检
  5. simvowifi provision         # 读卡并生成 engine 配置
  6. simvowifi start             # 启动引擎
  7. simvowifi status            # 等待 隧道=CONNECTED / IMS=Registered
  8. simvowifi linphone          # 按 iOS Linphone 配置指引操作
EOF
