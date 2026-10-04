# 故障排查

先跑 `simvowifi doctor`，再按下表对号入座。日志：`simvowifi logs -f`。

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
