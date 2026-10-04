"""config.py — simvowifi 配置读写（data/config.yaml）。

配置只有一个文件，单线路优先。密钥（SIP 账号密码 / AMI secret）在 init 时生成。
"""
from __future__ import annotations

import os
import secrets
import socket
import string

import yaml

# 仓库根目录 = ctl/app/ 的上两级
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.environ.get("SIMVOWIFI_DATA", os.path.join(REPO, "data"))
CONFIG_PATH = os.path.join(DATA_DIR, "config.yaml")
INSTANCE_PATH = os.path.join(DATA_DIR, "instance.json")
COMPOSE_FILE = os.path.join(REPO, "docker-compose.yml")


def gen_password(n: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))


def detect_lan_ip() -> str:
    """探测本机对外地址（UDP connect 技巧，不实际发包）。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 53))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def default_config() -> dict:
    return {
        "line": {
            "name": "",
            "pin": "",
            "imei": "",
            "msisdn": "",
            "smsc": "",            # 空 = provision 时读卡（EF_SMSP）
            "apn": "ims",
            "idr_mode": "apn",     # apn | fqdn
            "cp_mode": "v4",       # v4 | v6 | dual | auto。3HK 必须 v4；IPv6 IMS（EE/Telus）用 v6；auto 按 cp_mode_order 逐个试
            "epdg": "",            # ePDG 地址。空 = 按 IMSI 推导标准 3GPP FQDN。3HK 不发布标准 DNS → 填 wlan.three.com.hk
            "sec_encryption": False,  # IMS 层 IPsec sec-agree。3HK 不建（RTP 由隧道 ESP 保护）→ False
            "use_reauth_id": True,
            "rekey_minutes": 30,
            "pani_country": "",    # 空 = 按 MCC 自动
        },
        "sip": {
            "transport": "udp",    # udp | tcp | tls（Linphone iOS 建议 udp/tcp）
            "advertise_address": "",  # 空 = 自动探测
            "ring_timeout": 35,
            "account": {"username": "linphone", "password": gen_password()},
        },
        "bark": {
            "server": "https://api.day.app",
            "key": "",
            "group": "simvowifi",
            "call_sound": "bell",
            "call_level": "critical",  # critical 可绕过静音（需 iOS 授权）
            "include_body": True,
            "events": {
                "call_in": True, "sms_in": True,
                "tunnel_down": True, "tunnel_up": True, "registered": True,
            },
            # 推送加密（可选，需与 Bark App 首页『推送加密』设置完全一致；key 留空=不加密）
            "encrypt": {"algorithm": "AES128", "mode": "CBC", "key": "", "iv": ""},
        },
        "ami": {"user": "simvowifi", "secret": gen_password(), "port": 5038},
        "webui": {
            "enable": True,
            "host": "0.0.0.0",   # 局域网可访问；仅本机改 127.0.0.1
            "port": 8080,
            "password": gen_password(),
        },
        "ports": {
            "sip_udp": 5060, "sip_tls": 5061,
            "ami": 5038, "rtp_start": 10000, "rtp_span": 60,
        },
        "debug": {"asterisk": True},
    }


def load() -> dict:
    if not os.path.exists(CONFIG_PATH):
        raise FileNotFoundError(
            f"配置不存在: {CONFIG_PATH}\n请先运行: simvowifi init"
        )
    with open(CONFIG_PATH) as f:
        cfg = yaml.safe_load(f) or {}
    base = default_config()
    # 深度合并：以文件值覆盖默认值
    _deep_merge(base, cfg)
    return base


def _deep_merge(base: dict, over: dict):
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


def save(cfg: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)
    os.replace(tmp, CONFIG_PATH)


def ensure_dirs():
    for d in ("logs", "run", "certs"):
        os.makedirs(os.path.join(DATA_DIR, d), exist_ok=True)


def advertise_address(cfg: dict) -> str:
    """SIP 对外通告地址：配置优先，否则自动探测。"""
    explicit = (cfg.get("sip", {}).get("advertise_address") or "").strip()
    return explicit or detect_lan_ip()
