# 安装部署详解

## 前提条件

| 项目 | 要求 |
|---|---|
| 主机 | Debian 12+ / Ubuntu 22.04+ / Armbian，amd64 或 arm64（树莓派 4/5 可） |
| 内核 | `/dev/net/tun` 可用（绝大多数发行版默认有） |
| 网络 | 能访问公网（IKEv2 UDP 500/4500 出站） |
| 读卡器 | 任意 USB CCID PC/SC 读卡器（如 SCR3310、ACR38U、Alcor AK9563） |
| SIM | 支持 VoWiFi 的卡（运营商允许 ePDG 接入） |
| iOS | Linphone + Bark（App Store） |

> **国内运营商现状**：移动/联通/电信的个人卡普遍未开放 ePDG（VoWiFi 主要面向海外漫游），
> 且部分省份 ePDG 域名不解析。建议先用 `simvowifi doctor` 检查 ePDG 域名是否可解析。
> 海外卡（T-Mobile US、Telus CA、EE UK、Vodafone 等）实测可用性见上游
> [vowifi_gateway](https://github.com/pagecat/vowifi_gateway)。

## 安装步骤

```bash
sudo ./install.sh              # 或 SKIP_BUILD=1 sudo ./install.sh 跳过镜像构建
```

install.sh 做的事：
1. `apt install pcscd pcsc-tools python3-pyscard python3-yaml …` 并启动 pcscd
2. 安装 Docker（已有则跳过）
3. 建 `.venv`（控制面用，复用系统 pyscard）
4. 安装 `simvowifi` 命令到 `/usr/local/bin`
5. 构建 `simvowifi/engine:latest` 镜像（编译 sysmocom Asterisk，10-20 分钟，约 2GB）

## 配置

```bash
simvowifi init
$EDITOR data/config.yaml
```

必填项：
- `bark.key` — Bark App 打开即显示（形如 `https://api.day.app/xxxxxxxx`，只填 key 部分）
- `line.pin` — SIM 启用了 PIN 则必填
- `line.msisdn` — 本机号码（选填，用于外呼主叫显示）

运营商相关（默认值已适配 3HK 实测，详见 故障排查.md 的「运营商适配」）：
- `line.epdg` — ePDG 地址。留空 = 按 IMSI 推导标准 3GPP FQDN；3HK 必须填 `wlan.three.com.hk`（不走标准 DNS）
- `line.cp_mode` — 默认 `v4`（3HK 必须 v4，IPv6 PDN 会 EAP FAILURE）；IPv6 IMS 运营商（EE/Telus）用 `v6` 或 `auto`
- `line.sec_encryption` — 默认 `false`（3HK 不建 IMS 层 IPsec，RTP 由隧道 ESP 保护）

> 提示：`cp_mode: v4` 的部署建议在 VM/主机层面也禁用 IPv6，避免地址选择干扰。

## 读卡开通

```bash
simvowifi doctor       # 全绿再继续
simvowifi provision    # 读 IMSI/ICCID/SMSC → data/instance.json
simvowifi start
simvowifi status       # 等待 隧道=CONNECTED 且 IMS=Registered
```

引擎内部流程（自动完成）：验证 PIN → IKEv2/EAP-AKA 建立到 ePDG 的 IPsec 隧道 →
获取 P-CSCF → Asterisk 向 IMS 注册 → Bark 推送「✅ IMS 已注册」。

## Linphone

见 [LINPHONE.md](LINPHONE.md)。核心参数 `simvowifi linphone` 会打印。

## 升级 / 卸载

```bash
# 升级：拉取新代码后
sudo ./install.sh          # 重建镜像
simvowifi restart

# 卸载
simvowifi stop
docker rmi simvowifi/engine:latest
rm /usr/local/bin/simvowifi   # 保留 data/ 里的配置与短信记录，确认不需要再删
```

## 开机自启

engine 容器 `restart: unless-stopped`，Docker 服务随系统启动即自动拉起。
宿主机需确保 `pcscd`、`docker` 两个服务 enabled（install.sh 已处理）。
