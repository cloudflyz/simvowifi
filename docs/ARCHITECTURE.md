# 架构

## 总览

```
USB 读卡器 ──PC/SC──▶ pcscd(宿主) ──socket──▶ engine 容器
                                                │
              ┌─────────────────────────────────┤
              │  pin_keeper.py   持有 PIN(CHV1) 已验证
              │  swu_ike.py      IKEv2+EAP-AKA → ePDG，用户态 ESP over tun(ipsec0)
              │                  申请 IPv6 内网地址 + P-CSCF
              │  ami_usim.py     AMI ↔ PC/SC 桥（Asterisk SIP IMS-AKA 鉴权用 SIM）
              │  render.py       instance.json → Asterisk 配置(Jinja2)
              │  Asterisk(sysmocom 20.7.0 IMS 分支)
              │     ├─ volte_ims endpoint  经隧道注册运营商 IMS（AMR 语音/SMS over IMS）
              │     └─ linphone endpoint   本地 SIP 账号（UDP/TCP/TLS 5060）
              │  notify.py+bark.py  事件 → Bark 推送
              └─────────────────────────────────┘
                     ▲ SIP:5060/5061       ▲ 推送
                     │                     │
              Linphone(iOS)          Bark(iOS)
```

## 控制面（ctl/）

无 WebUI，纯 CLI（`bin/simvowifi`）：

| 模块 | 职责 |
|---|---|
| `app/cli.py` | 命令入口（init/doctor/provision/start/status/sms/call/bark/linphone…） |
| `app/config.py` | `data/config.yaml` 读写、密钥生成、LAN IP 探测 |
| `app/sim.py` | PC/SC 读卡：IMSI/ICCID/SMSC(EF_SMSP)/PIN 状态（源自 vowifi_gateway） |
| `app/usbreader.py` | 读卡器 ↔ 物理USB端口 绑定（多读卡器防串卡） |
| `app/instance.py` | 生成 engine 的 `data/instance.json`（契约见 engine/render.py） |
| `app/ami.py` | 极简同步 AMI 客户端：注册状态/短信/外呼 |
| `app/dockerops.py` | docker compose 生命周期、隧道状态文件、事件日志 |
| `app/sms.py` | 短信记录解析 + Bark 测试 |

## 引擎（engine/，源自 vowifi_gateway + Bark 扩展）

| 文件 | 职责 | simvowifi 改动 |
|---|---|---|
| `swu_ike.py` | 纯 Python IKEv2/IPsec ePDG 客户端（SWu-IKEv2, GPLv3） | 无 |
| `pin_keeper.py` | 保持 CHV1 验证态，让 EAP-AKA 和 IMS-AKA 并行工作 | 无 |
| `ami_usim.py` | Asterisk AMI ↔ SIM 桥（IMS-AKA 的 AUTN/RES 计算） | 无 |
| `render.py` | instance.json → pjsip/extensions 等 Asterisk 配置 | **+bark_env_lines()** |
| `notify.py` | 拨号计划/隧道事件钩子 | **+bark_dispatch()** |
| `bark.py` | **新增**：Bark 推送客户端（critical/声音/分组/点击唤起） |
| `templates/` | pjsip（IMS + 本地 SIP 账号）、extensions（来电→Dial、短信→转发+通知） | 无 |

## 关键数据流

**来电**：ePDG→IMS INVITE→`[volte_ims]` exten→`Progress/Ringing`→
`notify.py call_in`→**Bark critical 推送**＋`Dial(PJSIP/linphone,60)`→Linphone 振铃/接听→AMR↔opus/ulaw 转码桥接

**来短信**：IMS MESSAGE→`[volte_ims_msg]`→写 messages.txt→`notify.py sms_in`→**Bark 推送正文**＋`MessageSend(pjsip:linphone)` 转发到 Linphone 聊天

**去电**：Linphone INVITE→`[from-local]`→`Dial(PJSIP/<号码>@volte_ims,35)`→经隧道出局

**去短信**：Linphone MESSAGE→`[msg-from-local]`→`MessageSend(volte_ims)`（CLI `sms send` 走 AMI 同路径）

## 端口

| 端口 | 协议 | 用途 |
|---|---|---|
| 5060 | UDP/TCP | Linphone SIP（`transport-local`） |
| 5061 | TCP/TLS | SIP over TLS（可选） |
| 5038 | TCP | AMI（CLI 状态/短信/外呼，仅本机使用建议防火墙封禁） |
| 10000-10059 | UDP | RTP 媒体 |
| 容器内 5060 | TCP | IMS 核心传输（bind_interface=ipsec0，不映射宿主） |

## 与上游差异

- 控制面：FastAPI+React WebUI → **CLI**（更轻，适合单线路；多线路规划中）
- 通知：manager HTTP 事件 + webhook/telegram → **Bark 直推**（engine 内置，无 manager 依赖）
- 客户端定位：浏览器 WebRTC 软电话 → **Linphone**（WebRTC 保留开关，默认关）
