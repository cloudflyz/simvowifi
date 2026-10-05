# simvowifi

**把物理 SIM 变成你自己的 VoWiFi 通话/短信网关：Linux 主机 + 读卡器 → ePDG 隧道 → IMS，
iOS 用 Linphone 接打电话，来电/短信用 Bark 推送。**

```
                    USB 读卡器 + SIM
                          │ PC/SC
                          ▼
┌─────────────────── Linux 主机 ───────────────────┐
│  ┌────────────────────────────────────────────┐  │
│  │  simvowifi engine（Docker 容器）            │  │
│  │   · swu_ike   ePDG IKEv2/IPsec 隧道(EAP-AKA)│  │
│  │   · Asterisk  IMS 注册 / 通话 / SMS         │  │
│  │   · bark      来电/短信 → iOS 推送          │  │
│  └──────┬──────────────────────┬───────────────┘  │
└─────────┼──────────────────────┼──────────────────┘
          │ SIP:5060             │ Bark 推送
          ▼                      ▼
   ┌─────────────┐        ┌─────────────┐
   │ Linphone iOS │        │  Bark App   │
   │ 接打电话/短信 │◀───────│ 来电唤醒/短信 │
   └─────────────┘  点通知  └─────────────┘
```

## 功能

| 能力 | 说明 |
|---|---|
| 📞 接打电话 | Linphone（iOS/任何 SIP 客户端）注册本机 SIP，经运营商 IMS 线路双向通话，AMR↔G711/Opus 自动转码 |
| 💬 收发短信 | SIP MESSAGE ↔ 运营商 SMS；Linphone 聊天直接收发；CLI 也能 `simvowifi sms send` |
| 🔔 Bark 推送 | 来电（critical 级别，静音也响铃+点击唤起 Linphone）、短信、隧道断开/注册成功 |
| 🖥 WebUI | 浏览器管理：总览/短信/通话、WebRTC 软电话、SIM 开通、Bark/配置/日志（`simvowifi web`，详见 [docs/WEBUI.md](docs/WEBUI.md)） |
| 🔐 SIM 鉴权 | EAP-AKA / IMS-AKA 在物理 SIM 内完成，**不读取 Ki/OPC**，PIN 卡支持 |
| 📟 单命令运维 | `simvowifi doctor/provision/start/status/...`，CLI 与 WebUI 互为替代 |

## 硬件与前提

- **Linux 主机**：Debian 12+/Ubuntu 22.04+/Armbian（amd64/arm64，树莓派可），需 Docker、`/dev/net/tun`
- **USB PC/SC 读卡器**（CCID）+ **支持 VoWiFi 的 SIM**（运营商需允许 ePDG 漫游接入；国内
  三大运营商目前大多不开放个人 VoWiFi，海外卡如 T-Mobile/Telus/EE 等实测可用——参考上游
  [vowifi_gateway](https://github.com/pagecat/vowifi_gateway) 的运营商兼容性）
- **iOS**：App Store 装 [Linphone](https://apps.apple.com/us/app/linphone/id360065638) 和 [Bark](https://apps.apple.com/us/app/bark-push-notifications/id1403753865)

## 快速开始

```bash
git clone <本仓库> && cd simvowifi
sudo ./install.sh        # 装 pcscd/Docker/CLI，构建 engine 镜像（10-20 分钟）
simvowifi init           # 初始化配置
$EDITOR data/config.yaml # 填 Bark key（App 里复制）、SIM PIN 等
simvowifi doctor         # 体检
simvowifi provision      # 插卡后读卡 → 生成 engine 配置
simvowifi start && simvowifi status
simvowifi linphone       # iOS 配置指引（账号/密码/服务器）
```

## 运维命令

```bash
simvowifi status            # 容器/隧道/IMS 注册/Linphone 在线
simvowifi web               # Web 管理界面（浏览器 :8080，详见 docs/WEBUI.md）
simvowifi logs -f           # 跟踪引擎日志
simvowifi sms list          # 最近短信
simvowifi sms send +8613x "你好"   # CLI 发短信
simvowifi call +8613x       # 外呼：先振铃 Linphone，接听后拨出
simvowifi bark test         # 测试推送
simvowifi restart           # 重启引擎
```

## 目录结构

```
simvowifi/
├── engine/          # ePDG 隧道 + Asterisk IMS 引擎（Docker），源自 vowifi_gateway (MIT) + Bark 扩展
├── ctl/             # 控制面：CLI + WebUI 后端（Flask）
├── webui/           # WebUI 前端源码（React + Vite），dist/ 已预构建可直接部署
├── bin/simvowifi    # CLI 入口
├── docker-compose.yml
├── install.sh
├── config.example.yaml
└── docs/            # SETUP / LINPHONE / BARK / WEBUI / ARCHITECTURE / TROUBLESHOOTING
```

## 文档

- [docs/SETUP.md](docs/SETUP.md) — 安装部署详解
- [docs/LINPHONE.md](docs/LINPHONE.md) — iOS Linphone 配置与后台限制说明
- [docs/BARK.md](docs/BARK.md) — Bark 推送配置（重要告警/声音/自建服务器）
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架构与组件
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — 故障排查

## 致谢与许可

本项目基于 **[pagecat/vowifi_gateway](https://github.com/pagecat/vowifi_gateway)**（MIT）的引擎构建，
隧道核心 **[fasferraz/SWu-IKEv2](https://github.com/fasferraz/SWu-IKEv2)** 为 GPLv3，
Asterisk 使用 **[sysmocom](https://gitea.sysmocom.de/sysmocom/asterisk)** IMS 分支。
整体以 **GPLv3** 发布，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
架构另参考 [MddIdd/mdd-sim-gateway](https://github.com/MddIdd/mdd-sim-gateway)。

## ⚠️ 合规提示

本工具让 SIM 卡脱离手机通过运营商 IMS 网络注册。请确认你的运营商条款允许此类使用；
SIM/号码实名归属请遵守当地法规。仅供个人自有 SIM 卡使用。
