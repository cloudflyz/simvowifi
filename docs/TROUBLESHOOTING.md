# 故障排查

先跑 `simvowifi doctor`，再按下表对号入座。日志：`simvowifi logs -f`。

## 运营商适配实测：3HK（香港 Three）

3HK 是目前唯一完整实测过的运营商，五个坑均已在本项目内置修复，记录于此供其他运营商对照：

| 症状 | 原因 | 本项目对策（已内置/可配） |
|---|---|---|
| 隧道一直建不起来，标准 ePDG 域名解析得 `127.0.0.1` | 3HK 不通过标准 3GPP DNS 发布 ePDG（哨兵值） | `line.epdg: "wlan.three.com.hk"` 手动指定（CNAME → `wlan.datapath.three.com.hk`） |
| IKE_AUTH 后 EAP FAILURE | 默认 `cp_mode: auto` 先请求 IPv6 PDN，3HK 不接受 | `line.cp_mode: "v4"`（已是默认）；VM/主机建议同步禁用 IPv6 |
| IMS 注册循环报 `'401' fatal response received ... retrying in '30' seconds` | 3HK P-CSCF 的 401 不带 Security-Server 头（违反 TS 33.203），sysmocom 代码把每个 401 当 SA 协商 | 构建补丁 `reauth_missing_security_server.py`：任何无 Security-Server 的 401 直接跳过 sec-agree（需完整 docker build，overlay 无编译好的 .so） |
| 注册成功但通话无声音（RTP Timeout） | `sec_encryption=yes` 让 Asterisk 期望 IMS 层 IPsec SA，3HK 不建立，P-CSCF 不发 RTP | `line.sec_encryption: false`（已是默认，渲染为 pjsip `sec_encryption=no`）；RTP 由隧道 ESP 本身保护 |
| 通话/短信媒体出不去，WebRTC/SIP 无声 | swu_ike 的 `0.0.0.0/1 + 128.0.0.0/1` 把全部 IPv4 吸进隧道，发往 RFC1918 的 RTP 被丢 | `swu_ike.py` LAN-bypass 末尾新增 RFC1918 目标路由（192.168/10/172.16 → 容器网关），已内置 |

3HK 参考配置（`config.yaml` 的 `line:` 段）：

```yaml
line:
  epdg: "wlan.three.com.hk"
  cp_mode: "v4"
  sec_encryption: false
```

## provision 阶段

| 症状 | 原因与处理 |
|---|---|
| 未发现读卡器 | `lsusb` 看设备；`systemctl status pcscd`；`pcsc_scan`（装 pcsc-tools） |
| 读卡失败/需要 PIN | 启用 PIN 的卡先把 `line.pin` 填进 config 再 provision |
| `IMSI 读出但报 USIM 错误` | 卡可能是 2G SIM（无 USIM AID），VoLTE/VoWiFi 需要 USIM，换卡 |
| ePDG 域名无法解析 | 运营商未开放 VoWiFi（国内常见），或 DNS 问题换 8.8.8.8 试试 |
| PIN 剩余尝试很少 | ⚠️ 别再试！用手机解 PIN 或 PUK。simvowifi 有 ≥2 次保护，但别依赖 |

## 隧道阶段（status: 隧道非 CONNECTED）

| 症状 | 处理 |
|---|---|
| 卡在 IKE_SA_INIT | 出站 UDP 500/4500 被防火墙拦截；或 ePDG 不通（doctor 查域名） |
| EAP-AKA 拒绝 (AUTH failed) | 多为运营商不支持 ePDG 接入，或卡的 VoWiFi 未开通 |
| 反复 24300 拒绝 + backoff | ePDG 明确拒绝（无 VoWiFi 权限/漫游限制），上游亦有此现象 |
| 隧道 up 又立刻 down | `idr_mode` 换 `fqdn` 试试；`cp_mode` 指定 `v6` |

看原始 IKE 日志：`docker logs simvowifi-engine 2>&1 | grep -i swu | tail -50`

## IMS 注册阶段（隧道 CONNECTED 但 IMS 未 Registered）

| 症状 | 处理 |
|---|---|
| 401 后失败 | IMS-AKA 卡鉴权问题：确认 PIN 正确（pin_keeper 状态），读卡器没被别的程序占用 |
| 403 Forbidden | 运营商拒绝该 IMEI/线路。试换 `line.imei`（真机 IMEI 更稳） |
| 一直 Registering | P-CSCF 不通；`docker exec simvowifi-engine ping -6 <pcscf>`；检查 cp_mode |
| SMSC 相关 SMS 失败 | `simvowifi info` 看 SMSC 是否为空；手动填 `line.smsc`（运营商短信中心号） |

## 通话/媒体

| 症状 | 处理 |
|---|---|
| 注册正常但无铃声 | `simvowifi status` 看 Linphone 是否在线；iOS 后台被杀——靠 Bark 唤醒 |
| 单向无声 | RTP 端口 10000-10059/udp 未放行（主机防火墙）；advertise_address 不对（跨网段） |
| 通话 30 秒断 | `rtp.conf` 超时或运营商专用承载问题；`docker exec … rasterisk -x 'rtp set debug on'` |
| 声音质量差 | Linphone 关闭 Opus 强制 G711 试试；或 WiFi 信号 |
| 出局 480/603 | 号码格式：用国际格式 `+86…`；部分运营商不支持的号码段 |

## 短信

| 症状 | 处理 |
|---|---|
| 收不到（无 Bark 无 Linphone) | `data/logs/messages.txt` 有没有记录？无→IMS 层问题；有→Bark key/网络 |
| 发送返回失败 | SMSC 未配置或错误（`simvowifi info`）；Body 过长（>160 字符拆分未实现，先手短） |
| Bark 收到但 Linphone 没有 | Linphone 未注册/在后台；正常现象，Bark 里有正文 |

## Bark

- 测试：`simvowifi bark test`
- 引擎侧日志：`docker exec simvowifi-engine cat /logs/bark.jsonl`
- critical 不响铃：iOS 设置 → 通知 → Bark → 重要告警 开关

## 重置大法

```bash
simvowifi stop
rm -f data/instance.json data/run/* data/logs/*
simvowifi provision && simvowifi start
```

## 上游参考

更多隧道细节（NAT-T/DPD/rekey/运营商怪癖）见
[vowifi_gateway Troubleshooting](https://github.com/pagecat/vowifi_gateway#troubleshooting)。
