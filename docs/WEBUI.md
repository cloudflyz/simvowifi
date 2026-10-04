# WebUI 管理界面

浏览器管理 simvowifi：状态总览、短信收发、外呼、SIM 开通、配置编辑、日志、诊断。

## 启动

```bash
simvowifi web                # 前台运行，默认 0.0.0.0:8080
# 或开机自启（install.sh 已自动安装）:
systemctl enable --now simvowifi-web
```

浏览器打开 `http://<服务器IP>:8080`，密码在 `data/config.yaml` 的 `webui.password`。

## 功能

| 模块 | 说明 |
|---|---|
| 状态总览 | 容器 / ePDG 隧道 / IMS 注册 / Linphone 在线 / Bark 配置，5 秒自动刷新；最近事件流 |
| 短信 | 收发记录（与 CLI `sms list` 同源）+ 发送框 |
| 呼叫 | 输入号码拨出（Linphone 先振铃，接听后接通对方，同 CLI `call`） |
| 操作 | engine 启动/重启/停止、Bark 测试推送、一键诊断（doctor） |
| SIM 开通 | 读卡器列表 + provision（读卡 → 生成 instance.json，无需命令行） |
| Linphone 接入 | 服务器/账号/密码/SIP URI，一键复制，手机配置不用来回查 |
| 日志 | engine 输出 / Asterisk / IKE 隧道(charon) / 事件流 四个视图 |
| 配置 | 直接编辑 `data/config.yaml`（保存前做 YAML 校验；重启 engine 生效） |

## 安全

- 认证：`webui.password` → 签名 Session Cookie（30 天）；退出登录会**轮换签名密钥**，旧 Cookie 立即作废
- 密码错误有 1 秒限速；Cookie `SameSite=Lax`
- 默认监听 `0.0.0.0:8080`（局域网手机可访问）。仅本机使用改 `webui.host: 127.0.0.1`
- 改 `webui.password` 后所有会话立即失效（密钥由密码派生）

## 与 CLI 的关系

WebUI 与 CLI 完全同源（复用 `ctl/app` 的 dockerops/sms/sim/instance/ami 模块），
任何一边的操作另一边立即可见。WebUI 不新增任何状态文件（除 `data/webui.epoch` 会话轮换计数）。
