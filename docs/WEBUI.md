# WebUI

simvowifi 自带一个 Web 管理界面（React SPA），由 `simvowifi web`（Flask）同源提供，无需额外依赖：

- **总览**：开通状态五步流水线（开通 → 容器 → ePDG 隧道 → IMS 注册 → Linphone）、线路信息（号码/IMSI/ICCID/SMSC…）、事件流、生命周期（启动/停止/重启）、自检诊断、Linphone 接入信息。
- **短信**：会话式收发、按会话/单条/全部删除、来件提示。
- **软电话**：浏览器内 WebRTC 接打电话（振铃、拨号盘、DTMF、静音、录音、最近通话）。
- **SIM 开通**：读卡器管理、检测读卡、PIN 解锁、一键开通（provision）、PIN 管理（改 PIN / 启用 / 关闭）。
- **设置**：Bark 推送（含推送加密）、WebRTC 软电话开关、WebUI HTTPS 开关、config.yaml 在线编辑。
- **日志**：engine 入口 / Asterisk / SWu 隧道(IKE) / 事件流 四路日志，保留 ANSI 颜色，自动刷新。
- 支持亮/暗/自动主题，桌面与手机（≤860px 底部导航）自适应。

## 启动

```bash
sudo simvowifi web            # 交互式
sudo systemctl start simvowifi-web   # 或 systemd 常驻（deploy/ 已提供 unit）
```

浏览器打开 `http://<主机>:8080`，密码是 `data/config.yaml` 里的 `webui.password`
（`simvowifi init` 自动生成；`simvowifi passwd` 可修改）。

## 认证

- 登录后签发 HttpOnly Cookie 会话（30 天），所有 `/api/*` 需要登录，未登录返回 401。
- 点「退出登录」会作废**所有**已签发的会话（服务端递增 `data/webui.epoch`）。
- 改 `webui.password` 后重启 WebUI，旧会话全部失效。
- 开启 HTTPS（见下）后 Cookie 自动带 `Secure` 标记。

## 浏览器软电话（WebRTC）

1. **设置 → 浏览器软电话**：勾选启用（写入 `sip.webrtc.enable`）。
2. **SIM 开通**页对已插入的卡重新「开通」（provision）——把 WebRTC SIP 账号渲染进 engine 配置。
3. **总览**页重启 engine，engine 开始监听 WSS（默认 8089，映射见 docker-compose.yml）。
4. 麦克风要求**安全上下文**：
   - 先开 `https://<主机>:8089/` 一次并接受自签名证书；
   - 再用 `https://` 访问 WebUI（开启「设置 → WebUI HTTPS」并重启 `simvowifi-web`）。
   - `localhost` 访问无需 HTTPS。

WebRTC SIP 账号（`sip.webrtc.username/password`）在 `simvowifi init` 时自动生成。

## 开发模式

前端源码在 `webui/`（React 18 + Vite + Tailwind 4，无需了解后端即可二次开发）：

```bash
cd webui
npm install
npm run dev        # vite dev server，/api 代理到 SIMVOWIFI_DEV_API（默认 :8080）
npm run build      # 产物输出 webui/dist（Flask 直接托管的就是这份）
```

生产部署**不需要 Node**：`webui/dist` 已随仓库提供，Flask 直接托管。

### 后端 API（`ctl/app/webui.py`）

SPA 与 CLI 共用同一套 JSON API（CLI 侧见 `cli.py`），WebUI 专属补充：

| 端点 | 说明 |
| --- | --- |
| `GET /api/session` | 会话状态（是否登录/TLS/版本） |
| `POST /api/login` / `POST /api/logout` | 登录（错误密码限速 1s）/ 登出（作废所有会话） |
| `GET /api/overview` | 总览聚合（线路/容器/隧道/IMS/Linphone/事件/Bark） |
| `GET/POST /api/sms`，`POST /api/sms/delete` | 短信列表 / 发送 / 删除（`{ids:[..]}`、`{peer}`、`{all}`） |
| `GET /api/calls`，`POST /api/calls/delete` | 通话记录（与事件流 FIFO 关联出状态）/ 删除 |
| `POST /api/call` | 经 Linphone 客户端外呼（响铃） |
| `GET /api/softphone`，`POST /api/webrtc` | 软电话参数 / WebRTC 开关 |
| `POST /api/webui_tls` | WebUI HTTPS 开关（自签名证书放 `data/certs`，与 engine 共用） |
| `GET /api/readers`，`GET /api/card?reader=N`，`POST /api/provision` | 读卡器 / 读卡 / 开通 |
| `POST /api/sim/verify_pin` / `change_pin` / `pin_enabled` | PIN 解锁 / 修改 / 启停 |
| `GET/POST /api/bark_settings`，`POST /api/bark_test` | Bark 推送设置 / 测试 |
| `GET/POST /api/config` | config.yaml 读取 / 校验保存 |
| `GET /api/logs?which=entrypoint\|asterisk\|charon\|events` | 日志（保留 ANSI 颜色，前端渲染） |
| `POST /api/lifecycle` | `{action: start\|stop\|restart}` |
| `GET /api/doctor` | 环境自检（7 项） |
| `GET /api/linphone` | Linphone/SIP 客户端接入参数 |

## 界面速览

```
┌────────────────────────────────────────────────┐
│ ▤总览 ✉短信 ☎软电话 ▣SIM开通 ⚙设置 ≣日志   🌗 退出 │
├────────────────────────────────────────────────┤
│  ● 号码 +8613800138000        [重启] [停止]      │
│  开通 ✓ 容器 ✓ 隧道 ✓ IMS ✓ Linphone ✓          │
│  …事件流 / 诊断 / 外呼 / Bark…                   │
└────────────────────────────────────────────────┘
```

## 致谢

WebUI 布局与浏览器软电话（JsSIP）改编自 [pagecat/vowifi_gateway](https://github.com/pagecat/vowifi_gateway)
（MIT License），见仓库根 `NOTICE`。
