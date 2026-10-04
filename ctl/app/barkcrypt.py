"""barkcrypt.py — Bark 推送加密（host/ctl 侧，WebUI 测试推送用）。

与 engine/bark.py 的 encrypt_params 逐字节兼容（同一 Bark App 规格）：
  App 源码 Model/Algorithm.swift + CiphertextProcessor.swift
  - algorithm AES128/192/256 × mode CBC/ECB/GCM × padding pkcs7
  - key/iv 为 ASCII 字符串，UTF-8 bytes 即密钥/IV（key 16/24/32 字符；iv CBC 16 / GCM 12）
  - 加密对象 = 推送参数 JSON；密文 base64 后作 ciphertext 参数，iv 随推送发送（覆盖 App 内配置）
两端保持一致——修改任一处必须同步另一处（有交叉一致性测试）。
"""
from __future__ import annotations

import base64
import json
import secrets

from Crypto.Cipher import AES  # pycryptodome

KEYLEN = {"AES128": 16, "AES192": 24, "AES256": 32}
IVLEN = {"CBC": 16, "GCM": 12, "ECB": 0}
_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def validate(algorithm: str, mode: str, key: str, iv: str = "") -> str | None:
    """配置校验，返回错误信息（None = 通过）。"""
    if algorithm not in KEYLEN:
        return f"算法仅支持 {'/'.join(KEYLEN)}"
    if mode not in IVLEN:
        return "模式仅支持 CBC/ECB/GCM"
    n = KEYLEN[algorithm]
    if len(key) != n or len(key.encode()) != n:
        return f"{algorithm} 密钥必须是 {n} 位 ASCII 字符（当前 {len(key)}）"
    if key and not key.isascii():
        return "密钥只能包含 ASCII 字符"
    want = IVLEN[mode]
    if iv:
        if len(iv) != want or not iv.isascii():
            return f"{mode} 模式 IV 必须是 {want} 位 ASCII 字符（留空则每条随机）"
    return None


def _random_ascii(n: int) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(n))


def _pkcs7_pad(data: bytes, block: int = 16) -> bytes:
    n = block - len(data) % block
    return data + bytes([n]) * n


def encrypt_params(params: dict, algorithm: str, mode: str, key: str,
                   iv: str = "", padding: str = "pkcs7") -> dict:
    """加密推送参数 → {ciphertext, iv?}（App 端以推送携带的 iv 为准解密）。"""
    err = validate(algorithm, mode, key, iv)
    if err:
        raise ValueError(err)
    kb = key.encode("utf-8")
    plaintext = json.dumps(params, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    out: dict = {}
    if mode == "GCM":
        iv_s = iv or _random_ascii(12)
        c = AES.new(kb, AES.MODE_GCM, nonce=iv_s.encode())
        ct, tag = c.encrypt_and_digest(plaintext)
        blob = ct + tag  # CryptoSwift GCM .combined: 密文+认证标签
        out["iv"] = iv_s
    elif mode == "CBC":
        iv_s = iv or _random_ascii(16)
        c = AES.new(kb, AES.MODE_CBC, iv=iv_s.encode())
        blob = c.encrypt(_pkcs7_pad(plaintext))
        out["iv"] = iv_s
    else:  # ECB（无 IV，不建议：相同明文块产生相同密文）
        c = AES.new(kb, AES.MODE_ECB)
        blob = c.encrypt(_pkcs7_pad(plaintext))
    out["ciphertext"] = base64.b64encode(blob).decode("ascii")
    return out


def decrypt_payload(payload: dict, algorithm: str, mode: str, key: str) -> dict:
    """解密 encrypt_params 的输出（仅测试用：模拟 App 端解密验证往返）。"""
    blob = base64.b64decode(payload["ciphertext"])
    kb = key.encode()
    if mode == "GCM":
        c = AES.new(kb, AES.MODE_GCM, nonce=payload["iv"].encode())
        pt = c.decrypt_and_verify(blob[:-16], blob[-16:])
    elif mode == "CBC":
        c = AES.new(kb, AES.MODE_CBC, iv=payload["iv"].encode())
        pt = c.decrypt(blob)
        pt = pt[: -pt[-1]]  # 去 PKCS7
    else:
        c = AES.new(kb, AES.MODE_ECB)
        pt = c.decrypt(blob)
        pt = pt[: -pt[-1]]
    return json.loads(pt.decode("utf-8"))
