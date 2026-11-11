#!/usr/bin/env bash
# 生成 simvowifi 用的自签证书（Asterisk WSS + WebUI TLS 共用 data/certs/）
#   ./scripts/gen-certs.sh [额外 SAN ...]
# 例：./scripts/gen-certs.sh 192.168.5.241 simvowifi.local
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${SIMVOWIFI_DATA_DIR:-$ROOT/data}"
CERT_DIR="$DATA_DIR/certs"
CRT="$CERT_DIR/certificate.crt"
KEY="$CERT_DIR/certificate.key"

mkdir -p "$CERT_DIR"

LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
LAN_IP="${LAN_IP:-127.0.0.1}"

SAN="DNS:simvowifi.local,DNS:localhost,IP:$LAN_IP,IP:127.0.0.1"
for extra in "$@"; do
  case "$extra" in
    *[0-9].[0-9]*) SAN="$SAN,IP:$extra" ;;
    *)             SAN="$SAN,DNS:$extra" ;;
  esac
done

echo "生成证书："
echo "  CN      = simvowifi.local"
echo "  SAN     = $SAN"
echo "  输出    = $CRT / $KEY"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$KEY" -out "$CRT" -days 3650 \
  -subj "/CN=simvowifi.local" \
  -addext "subjectAltName=$SAN" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" >/dev/null 2>&1

chmod 600 "$KEY"
echo "完成。"
echo
echo "浏览器 / iOS 需要信任这张证书，否则 WSS（软电话）会被拒绝："
echo "  macOS : 钥匙串访问 → 导入 certificate.crt → 信任 → 始终信任"
echo "  iOS   : AirDrop/邮件发 certificate.crt → 设置 → 已下载描述文件 → 安装 →"
echo "          通用 → 关于本机 → 证书信任设置 → 对该根证书启用完全信任"
echo "  桌面  : 可用 chrome://flags 或系统证书库导入"
