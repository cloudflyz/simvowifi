# 3HK / SIMworld（PLMN 454-03）配置要点

来源：SIMHub 0.4.9 实跑日志（2026-11-10，241）+ simvowifi `config.example.yaml` 原始注释。
两者相互印证，按下面填即可。

## config.yaml

```yaml
line:
  name: "3HK"
  pin: ""                 # 卡有 PIN 才填
  imei: ""                # 留空 → provision 随机生成并回存
  msisdn: "+8525XXXXXXX"  # 按实际号码填，Bark 推送显示用
  smsc: ""                # 留空 → provision 读 EF_SMSP
  apn: "ims"
  idr_mode: "apn"
  cp_mode: "v4"           # 3HK 必须 v4；IPv6 PDN 会 EAP FAILURE
  epdg: "wlan.three.com.hk"   # 3HK 不发布标准 DNS（解析得 127.0.0.1）
  sec_encryption: false   # 3HK 不建 IMS IPsec，SIP 走明文，RTP 由隧道 ESP 保护
  use_reauth_id: true
  rekey_minutes: 30
  pani_country: "HK"
```

## 日志里能对上的行为（做验收基线）

| 阶段 | 期望 |
|---|---|
| IKE | UDP 500/4500，ePDG 可能先要 modp1024（不是 2048） |
| EAP | EAP-AKA，`challenge_mode=minimal`（不回 AT_CHECKCODE 也能过） |
| 隧道 | 内层 IPv4，P-CSCF 由 CP 属性下发（常见 10.5.236.x） |
| REGISTER | 未保护（无 Gm IPsec），`eap_direct`，1447–1452B，需内层 IP 分片 |
| 注册 | 200 OK，expires=7200，之后 SUBSCRIBE 200 |
| 下行 | P-CSCF 主动连 TCP（约 38180）下发 NOTIFY |
| 语音 | AMR-WB/AMR |
| DTMF | 3HK IVR 需要 `info`；模板已设 `dtmf_mode=auto_info` |

## DNS 注意

3HK 的 ePDG FQDN 在部分网络下解析不到或返回 127.0.0.1 哨兵值。若 `simvowifi doctor`
报「ePDG 解析得 127.0.0.1」，直接把真实 A 记录写死：

```bash
getent hosts wlan.three.com.hk   # 在能解析的环境查一次
echo "<真实IP> wlan.three.com.hk" >> /etc/hosts
```

本机若走 fake-ip（198.18.0.0/15）代理，务必确认解析结果不在该段，否则隧道会连到错误地址。
