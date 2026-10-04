"""sms.py — 短信收件解析（engine /logs/messages.txt）+ 发送封装。

messages.txt 由拨号计划追加，格式：
    IN SMS from <号码> at <时间>:\n<正文>\n=====\n
    OUT SMS to <号码> at <时间>:\n<正文>\n=====\n
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

from . import config as cfgmod

REC = re.compile(r"^(IN|OUT) SMS (?:from|to) (\S+) at (.+?):$", re.M)


def list_messages(limit: int = 20) -> list[dict]:
    path = os.path.join(cfgmod.DATA_DIR, "logs", "messages.txt")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    blocks = text.split("=====")
    msgs = []
    for b in blocks:
        b = b.strip("\n")
        if not b.strip():
            continue
        m = REC.search(b)
        if not m:
            continue
        direction, peer, ts = m.group(1), m.group(2), m.group(3)
        body = b[m.end():].strip("\n")
        msgs.append({"dir": direction, "peer": peer, "time": ts, "body": body})
    return msgs[-limit:][::-1]  # 最新的在前


def bark_test(server: str, key: str, bark_cfg: dict | None = None) -> tuple[bool, str]:
    """发一条测试推送，验证 Bark 服务器与 key。
    bark_cfg 传入完整 bark 配置节时，若配置了 encrypt.key 则发加密推送
    （与 engine 实际推送同一加密管线，可验证 App 端解密配置是否正确）。"""
    payload = {
        "title": "simvowifi 测试推送",
        "body": "✅ Bark 配置成功！来电与短信将推送到这里。",
        "group": "simvowifi",
        "sound": "bell",
    }
    enc_note = ""
    enc = (bark_cfg or {}).get("encrypt") or {}
    if enc.get("key"):
        from . import barkcrypt
        try:
            payload = barkcrypt.encrypt_params(
                payload,
                algorithm=str(enc.get("algorithm", "AES128")),
                mode=str(enc.get("mode", "CBC")),
                key=str(enc["key"]),
                iv=str(enc.get("iv", "")),
            )
            enc_note = f"（已加密: {enc.get('algorithm', 'AES128')}/{enc.get('mode', 'CBC')}）"
        except ValueError as e:
            return False, f"加密配置无效: {e}"
    url = f"{server.rstrip('/')}/push"
    data = json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return 200 <= resp.status < 300, f"HTTP {resp.status} {enc_note}".rstrip()
    except Exception as e:
        return False, repr(e)
