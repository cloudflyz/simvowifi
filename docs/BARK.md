# Bark 推送配置

Bark 是 iOS 推送工具（[App Store](https://apps.apple.com/us/app/bark-push-notifications/id1403753865)），
simvowifi 用它推送**来电、短信、隧道状态**。

## 获取 Key

1. App Store 安装 Bark，打开 App
2. 首页显示服务器地址形如 `https://api.day.app/AbCdEfGh1234`
   - `AbCdEfGh1234` 就是你的 **key**
   - 如果你用的是自建 bark-server，服务器部分对应改 `bark.server`
3. 填入 `data/config.yaml`：
   ```yaml
   bark:
     server: "https://api.day.app"
     key: "AbCdEfGh1234"
   ```
4. 验证：`simvowifi bark test` → 手机应收到测试推送

## 推送策略（默认）

| 事件 | 级别 | 声音 | 分组 | 说明 |
|---|---|---|---|---|
| 来电 `call_in` | **critical** | bell | simvowifi-call | 静音也响铃；点击尝试唤起 Linphone |
| 短信 `sms_in` | timeSensitive | tiptoe | simvowifi-sms | 正文直接进推送 |
| 隧道断开 `tunnel_down` | timeSensitive | alert | simvowifi-status | 引擎会自动重连 |
| IMS 注册成功 `registered` | active | receive | simvowifi-status | 线路就绪 |

## 重要告警（绕过静音）

critical 级别推送需要一次性授权：

1. iOS 设置 → 通知 → Bark → 开启「重要告警」（或首次收到时在弹窗允许）
2. Bark App 内确认「重要告警」开关已开

不想要绕静音？把 `bark.call_level` 改为 `timeSensitive` 或 `active`。

## 声音列表

推送声音名见 https://bark.day.app/#/sounds （bell、anticipate、calippo… 也支持自定义）。
改 `bark.call_sound` 后 `simvowifi restart` 生效。

## 隐私

不想短信内容出现在推送/锁屏：`bark.include_body: false`（推送只显示来信号码）。

## 自建 bark-server

```bash
docker run -dt --name bark-server -p 8080:8080 -v `pwd`/bark-data:/data finab/bark-server
# config.yaml: bark.server: "http://<主机IP>:8080"
```

## 排查

- `data/logs/bark.jsonl`（引擎容器内 `/logs/bark.jsonl`）记录每次推送结果
- key 错误 → `simvowifi bark test` 返回 400
- 服务器不可达 → 检查 `bark.server`、容器 DNS
