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
import re
import sys
import urllib.parse
import urllib.request

ENV_PATH = os.environ.get("VOWIFI_ENV", "/run/vowifi/engine.env")

# ── SMS 验证码提取（与 x3-server / YN076 同款算法，三项目统一）───────────────
# 关键词上下文优先（最精确），然后裸数字回退（4-6 位，排除服务码/年份）。
_SMS_CODE_KEYWORDS = (
    "验证码", "校验码", "动态码", "动态密码", "验证密码", "登录码",
    "CODE", "Code", "code", "OTP", "otp",
)
_SMS_CODE_KEYWORD_RE = re.compile(
    "(?:" + "|".join(re.escape(k) for k in _SMS_CODE_KEYWORDS) + ")[^0-9]{0,8}([0-9]{4,8})")
_SMS_CODE_BARE_RE = re.compile("(?:[^0-9]|^)([0-9]{4,6})(?:[^0-9]|$)")
_SMS_CODE_DENY_RE = re.compile(
    "^(?:10086|10010|10000|955[0-9][0-9]?|110|120|119|123[0-9][0-9]|20[0-9][0-9])$")


def _extract_sms_code(text: str) -> str:
    """从短信正文提取验证码，无则返回空字符串。"""
    if not text:
        return ""
    match = _SMS_CODE_KEYWORD_RE.search(text)
    if match:
        return match.group(1)
    # 裸数字回退：4-6 位，排除服务码和年份
    for match in _SMS_CODE_BARE_RE.finditer(text):
        candidate = match.group(1)
        if not _SMS_CODE_DENY_RE.match(candidate):
            return candidate
    return ""


# 每类事件的默认推送样式（可被 engine.env 中 BARK_* 覆盖）
DEFAULTS = {
    "call_in": {
        "sound": "alarm",
        "group": "VoIP",
        "level": "critical",
        "volume": "3",
        "url": "linphone:",
        "isArchive": 1,
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

# ---------------- 推送加密（与 Bark App 『推送加密』功能对应）--------------------
# 规格（App 源码 Model/Algorithm.swift + NotificationServiceExtension/CiphertextProcessor.swift）:
#   - 对称密钥，用户自定义：algorithm AES128/192/256 × mode CBC/ECB/GCM × padding pkcs7
#   - key/iv 都是 ASCII 字符串，其 UTF-8 bytes 即为密钥/IV（长度 16/24/32；iv: CBC 16 / GCM 12 字符）
#   - 加密对象 = 推送参数的 JSON 字符串；密文 base64 后作为 ciphertext 参数发送
#   - GCM 为 CryptoSwift .combined 布局 = ciphertext||tag(16B)
#   - 推送可携带 iv 参数，覆盖 App 内保存的 IV → 我们每条随机 IV（语义安全）

def _random_ascii(n: int) -> str:
    import secrets
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return "".join(secrets.choice(alphabet) for _ in range(n))


def encrypt_params(params: dict, algorithm: str, mode: str, key: str,
                   iv: str = "", padding: str = "pkcs7") -> dict:
    """加密推送参数 → {ciphertext, iv?}。与 App 端 AESCryptoModel 逐字节兼容。
    padding 仅支持 pkcs7（App 端选 noPadding 会因填充字节解密出错，需选 PKCS7）。"""
    import base64 as _b64
    import json as _json
    from Crypto.Cipher import AES  # pycryptodome（镜像已内置）

    keylen = {"AES128": 16, "AES192": 24, "AES256": 32}.get(algorithm)
    if not keylen:
        raise ValueError(f"不支持的算法 {algorithm}（仅 AES128/AES192/AES256）")
    if mode not in ("CBC", "ECB", "GCM"):
        raise ValueError(f"不支持的模式 {mode}（仅 CBC/ECB/GCM）")
    kb = key.encode("utf-8")
    if len(key) != keylen or len(kb) != keylen:
        raise ValueError(f"{algorithm} 密钥必须是 {keylen} 位 ASCII 字符（当前 {len(key)}）")

    plaintext = _json.dumps(params, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    out = {}
    if mode == "GCM":
        iv_s = iv or _random_ascii(12)
        c = AES.new(kb, AES.MODE_GCM, nonce=iv_s.encode("utf-8"))
        ct, tag = c.encrypt_and_digest(plaintext)
        blob = ct + tag  # CryptoSwift GCM(.combined)：密文+认证标签拼接
        out["iv"] = iv_s
    elif mode == "CBC":
        iv_s = iv or _random_ascii(16)
        c = AES.new(kb, AES.MODE_CBC, iv=iv_s.encode("utf-8"))
        blob = c.encrypt(_pkcs7_pad(plaintext))
        out["iv"] = iv_s
    else:  # ECB
        c = AES.new(kb, AES.MODE_ECB)
        blob = c.encrypt(_pkcs7_pad(plaintext))
    out["ciphertext"] = _b64.b64encode(blob).decode("ascii")
    # iv 参数随推送发送 → App 端以它为准解密（App 内配置的 iv 可任意）
    return out


def _pkcs7_pad(data: bytes, block: int = 16) -> bytes:
    n = block - len(data) % block
    return data + bytes([n]) * n


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
    payload = {"title": title, "body": body}
    for k, v in params.items():
        if v is not None and v != "":
            payload[k] = v
    return push_payload(server, key, payload)


def push_payload(server: str, key: str, payload: dict, encrypt: dict | None = None) -> bool:
    """发送最终 payload；encrypt 非 None 时（含 algorithm/mode/key/iv）先整体加密。"""
    if not server or not key:
        return False
    server = server.rstrip("/")
    if encrypt:
        try:
            payload = encrypt_params(payload, **encrypt)
        except Exception as e:  # noqa: BLE001
            print(f"[bark] 加密失败（按明文发送）: {e!r}", file=sys.stderr)
    encrypted = "ciphertext" in payload
    url = f"{server}/push"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json; charset=utf-8"}
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return 200 <= resp.status < 300
    except Exception as e:  # noqa: BLE001
        if encrypted:
            # 密文含二进制 base64，不适合 GET 路径回退，直接报错
            print(f"[bark] push failed: {e!r}", file=sys.stderr)
            return False
        # 回退到 GET 路径风格（老版本 bark-server 兼容）：/key/title/body?k=v
        try:
            extra = {k: v for k, v in payload.items() if k not in ("title", "body")}
            q = "&".join(f"{k}={urllib.parse.quote(str(v), safe='')}" for k, v in extra.items())
            path = f"{server}/{key}/{urllib.parse.quote(str(payload.get('title','')), safe='')}/{urllib.parse.quote(str(payload.get('body','')), safe='')}"
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
        ("isArchive", "BARK_ISARCHIVE"),
    ):
        if env.get(envk):
            style[k] = env[envk]
    if event == "call_in":
        style.setdefault("url", "linphone:")
        if env.get("BARK_CALL_SOUND"):
            style["sound"] = env["BARK_CALL_SOUND"]
        if env.get("BARK_CALL_LEVEL"):
            style["level"] = env["BARK_CALL_LEVEL"]
        if env.get("BARK_CALL_GROUP"):
            style["group"] = env["BARK_CALL_GROUP"]
        if env.get("BARK_CALL_ISARCHIVE"):
            style["isArchive"] = env["BARK_CALL_ISARCHIVE"]
    if event == "sms_in":
        # 隐私开关：BARK_INCLUDE_BODY=0 时短信内容不进推送，只报号码
        if env.get("BARK_INCLUDE_BODY", "1") == "0":
            body = "（内容已隐藏，请到 Linphone 查看）"
        # 验证码提取：提出来放 title（锁屏可见）+ copy 参数（点通知即复制）
        code = _extract_sms_code(body)
        if code:
            style["copy"] = code

    line_name = env.get("BARK_LINE_NAME", "")
    if line_name and event in ("call_in", "sms_in"):
        title = f"{title} · {line_name}" if title else line_name

    # 推送加密（BARK_ENC_KEY 非空时启用；App 端需配置相同算法/密钥）
    encrypt = None
    if env.get("BARK_ENC_KEY"):
        encrypt = {
            "algorithm": env.get("BARK_ENC_ALGORITHM", "AES128"),
            "mode": env.get("BARK_ENC_MODE", "CBC"),
            "key": env["BARK_ENC_KEY"],
            "iv": env.get("BARK_ENC_IV", ""),
        }

    payload = {"title": title, "body": body}
    payload.update({k: v for k, v in style.items() if v is not None and v != ""})
    ok = push_payload(server, key, payload, encrypt=encrypt)
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
