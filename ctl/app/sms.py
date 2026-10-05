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


def _messages_path() -> str:
    return os.path.join(cfgmod.DATA_DIR, "logs", "messages.txt")


def _parse_blocks(text: str) -> list[dict]:
    """把文件内容切成记录（不含 id）。id 由调用方按顺序号分配。"""
    out = []
    for b in text.split("====="):
        m = REC.search(b)
        if not m:
            continue
        out.append({"dir": m.group(1), "peer": m.group(2), "time": m.group(3),
                    "body": b[m.end():].strip("\n")})
    return out


def list_messages(limit: int = 20) -> list[dict]:
    path = _messages_path()
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    msgs = [{"id": i, **{k: r[k] for k in ("dir", "peer", "time", "body")}}
            for i, r in enumerate(_parse_blocks(text))]
    return msgs[-limit:][::-1]  # 最新的在前


def delete_messages(sel: dict) -> int:
    """删除短信并重写 messages.txt。sel: {ids:[...]} | {peer:"..."} | {all:True}。

    返回删除条数。id 与 list_messages 一致（按记录顺序号）；
    未匹配 REC 的块（损坏行）原样保留。
    """
    path = _messages_path()
    if not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    blocks = text.split("=====")
    records = _parse_blocks(text)
    ids = set(int(i) for i in (sel.get("ids") or []))
    peer = (sel.get("peer") or "").strip()
    drop_all = bool(sel.get("all"))
    drop = set()
    for i, r in enumerate(records):
        if drop_all or i in ids or (peer and r["peer"] == peer):
            drop.add(i)
    if not drop:
        return 0
    kept, ri = [], 0
    for b in blocks:
        if not REC.search(b):
            kept.append(b)          # 非记录块原样保留
            continue
        if ri not in drop:
            kept.append(b)
        ri += 1
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("=====".join(kept))
    os.replace(tmp, path)
    return len(drop)


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
