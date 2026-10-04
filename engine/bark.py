#!/usr/bin/env python3
"""
bark.py - Bark (iOS) 推送客户端，供 engine 内 notify.py 调用。

用法:
  bark.py <event> <title> <body> [b64_body]

设计要点:
  - 只依赖标准库（urllib），engine 镜像无需额外 Python 包；
  - 从 /run/vowifi/engine.env（由 render.py 写出）读取 BARK_* 配置；
  - 全部异常吞掉、永不失败——通知是 best-effort，绝不能阻塞拨号计划或隧道进程；
  - 支持 critical 级别（来电唤醒：即使手机静音也可响铃，需 iOS 16+ 且 Bark 开启授权）、
    声音、分组、点击跳转 URL（sip: scheme 唤起 Linphone）。

Bark 参数参考: https://bark.day.app/#/tutorial
"""
import base64
import json
import os
import sys
import urllib.parse
import urllib.request

ENV_PATH = os.environ.get("VOWIFI_ENV", "/run/vowifi/engine.env")

# 每类事件的默认推送样式（可被 engine.env 中 BARK_* 覆盖）
DEFAULTS = {
    "call_in": {
        "sound": "bell",
        "group": "simvowifi-call",
        # critical: 绕过静音/专注模式响铃，配合 volume；iOS 需在 Bark 设置中
        # 允许"重要告警"。改为 active/timeSensitive 可降级。
        "level": "critical",
        "volume": "3",
        # 点击通知尝试唤起 Linphone（iOS 通过 sip: URL scheme）
        "url": "linphone:",
    },
    "sms_in": {
        "sound": "tiptoe",
        "group": "simvowifi-sms",
        "level": "timeSensitive",
    },
    "tunnel_down": {
        "sound": "alert",
        "group": "simvowifi-status",
        "level": "timeSensitive",
    },
    "tunnel_up": {
        "sound": "receive",
        "group": "simvowifi-status",
        "level": "active",
    },
    "registered": {
        "sound": "receive",
        "group": "simvowifi-status",
        "level": "active",
    },
}

TIMEOUT = 8  # 秒；推送失败快速放弃，绝不挂住调用方


def load_env(path: str | None = None) -> dict:
    # 注意：不能写成 def load_env(path=ENV_PATH) —— 默认参数在定义时求值，
    # 测试/重定向 ENV_PATH 后不生效；必须在调用时读模块全局。
    # 值可能被 render.py 单引号包裹（shell source 安全），此处去除首尾引号。
    if path is None:
        path = ENV_PATH
    env = {}
    try:
        with open(path) as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    if len(v) >= 2 and v[0] == v[-1] == "'":
                        v = v[1:-1]
                    elif len(v) >= 2 and v[0] == v[-1] == '"':
                        v = v[1:-1]
                    env[k] = v
    except Exception:
        pass
    return env


def push(server: str, key: str, title: str, body: str, **params) -> bool:
    """POST 到 Bark 服务器。优先 JSON 接口（支持全部参数、正文转义最稳）。"""
    if not server or not key:
        return False
    server = server.rstrip("/")
    payload = {"title": title, "body": body}
    for k, v in params.items():
        if v is not None and v != "":
            payload[k] = v
    url = f"{server}/push"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json; charset=utf-8"}
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return 200 <= resp.status < 300
    except Exception as e:  # noqa: BLE001
        # 回退到 GET 路径风格（老版本 bark-server 兼容）：/key/title/body?k=v
        try:
            extra = {k: v for k, v in payload.items() if k not in ("title", "body")}
            q = "&".join(f"{k}={urllib.parse.quote(str(v), safe='')}" for k, v in extra.items())
            path = f"{server}/{key}/{urllib.parse.quote(title, safe='')}/{urllib.parse.quote(body, safe='')}"
            if q:
                path += "?" + q
            with urllib.request.urlopen(path, timeout=TIMEOUT) as resp:
                return 200 <= resp.status < 300
        except Exception:
            print(f"[bark] push failed: {e!r}", file=sys.stderr)
            return False


def notify(event: str, title: str, body: str, env: dict | None = None) -> bool:
    """按事件类型组装参数并推送。env 传 None 时自行读取 engine.env。"""
    env = env if env is not None else load_env()
    server = env.get("BARK_SERVER", "https://api.day.app")
    key = env.get("BARK_KEY", "")
    enabled = set(
        f.strip() for f in env.get("BARK_EVENTS", "call_in,sms_in,tunnel_down,tunnel_up,registered").split(",") if f.strip()
    )
    if not key:
        return False
    if event not in enabled:
        return False

    style = dict(DEFAULTS.get(event, {}))
    # engine.env 级覆盖（render.py 从 instance.json bark 段生成）
    for k, envk in (
        ("group", "BARK_GROUP"),
        ("sound", "BARK_SOUND"),
        ("level", "BARK_LEVEL"),
        ("volume", "BARK_VOLUME"),
        ("url", "BARK_URL"),
    ):
        if env.get(envk):
            style[k] = env[envk]
    if event == "call_in":
        style.setdefault("url", "linphone:")
        if env.get("BARK_CALL_SOUND"):
            style["sound"] = env["BARK_CALL_SOUND"]
        if env.get("BARK_CALL_LEVEL"):
            style["level"] = env["BARK_CALL_LEVEL"]
    if event == "sms_in":
        # 隐私开关：BARK_INCLUDE_BODY=0 时短信内容不进推送，只报号码
        if env.get("BARK_INCLUDE_BODY", "1") == "0":
            body = "（内容已隐藏，请到 Linphone 查看）"

    line_name = env.get("BARK_LINE_NAME", "")
    if line_name and event in ("call_in", "sms_in"):
        title = f"{title} · {line_name}" if title else line_name

    ok = push(server, key, title, body, **style)
    # 本地事件日志，便于排查推送问题
    try:
        os.makedirs("/logs", exist_ok=True)
        with open("/logs/bark.jsonl", "a") as f:
            f.write(json.dumps({"event": event, "ok": ok, "title": title}, ensure_ascii=False) + "\n")
    except Exception:
        pass
    return ok


if __name__ == "__main__":
    if len(sys.argv) >= 4:
        ev, title, body = sys.argv[1], sys.argv[2], sys.argv[3]
        if len(sys.argv) >= 5 and sys.argv[4]:
            # 正文以 base64 传入（拨号计划里含换行/特殊字符时用）
            try:
                body = base64.b64decode(sys.argv[4]).decode("utf-8", "replace") if body == "-" else body
            except Exception:
                pass
        sys.exit(0 if notify(ev, title, body) else 1)
    else:
        print("usage: bark.py <event> <title> <body|- [body_b64]>", file=sys.stderr)
        sys.exit(2)
