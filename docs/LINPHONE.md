# iOS Linphone 配置

`simvowifi linphone` 可随时打印当前账号参数。

## 账号配置

App Store 安装 **Linphone**（Belledonne 官方），打开：

```
设置 → 管理 SIP 账户 → + 新建 SIP 账户
  用户名:  linphone            ← sip.account.username
  密码  :  <config 里的随机密码> ← sip.account.password
  域名  :  <主机局域网 IP>       ← sip.advertise_address（simvowifi linphone 会显示）
  传输  :  UDP                  ← sip.transport（默认 udp；跨网段建议 tcp）
```

保存后账户应显示 **已注册**（可用 `simvowifi status` 查看 `Linphone: 在线`）。

## 通话

- **拨出**：拨号盘输入号码（国际格式 `+8613…`），直接走你的 SIM 线路
- **接听**：Linphone 在前台时正常振铃；在后台/被杀时靠 **Bark 推送唤醒**
  （点通知里的按钮/打开 App 后 Linphone 恢复注册并振铃，若对方还在振铃周期内即可接听）
- **CLI 外呼**：`simvowifi call +86…` 会先振铃你的 Linphone，接听后自动拨出

## 短信

- **收**：短信自动转发到 Linphone 聊天（对方号码会话）+ Bark 推送正文
- **发**：Linphone 聊天页新建会话发送，或 `simvowifi sms send +86… "内容"`

## iOS 后台限制（重要）

iOS 会挂起后台 App 的 socket，Linphone 官方推送需要其 Flexisip 服务，自建 SIP 无法使用。
实践建议：

1. **Bark critical 推送**（默认开启）：来电推送即使静音/专注模式也会响铃
   —— Bark App 设置里授权「重要告警」
2. Linphone 设置 → 网络：启用「保持后台」「TCP 保活」（传输选 TCP 时效果更好）
3. 局域网内使用（手机与主机同网段）延迟最低；跨网段把 `sip.transport` 改 `tcp`
4. 长期可靠接听方案：配一个旧安卓机/桌面端 MicroSIP 常驻在线

## 其他客户端

任何标准 SIP 客户端都能用同一账号注册（pjsip `max_contacts=3`，同账号多端可同时在线）：
- 桌面：MicroSIP（Windows）、Linphone Desktop、Zoiper
- 安卓：Linphone Android、SIPDroid
- 浏览器 WebRTC 已在本引擎禁用（如需可改 instance.json `sip.webrtc.enable`）
