"""instance.py — 生成 engine 的 /config/instance.json（与 engine/render.py 契约对齐）。

契约参考 vowifi_gateway control/app/config.render_instance_json（MIT © pagecat）。
"""
from __future__ import annotations

import json
import os

from . import config as cfgmod


def epdg_fqdn(mcc: str, mnc: str) -> str:
    return f"epdg.epc.mnc{int(mnc):03d}.mcc{mcc}.pub.3gppnetwork.org"


def ims_realm(mcc: str, mnc: str) -> str:
    return f"ims.mnc{int(mnc):03d}.mcc{mcc}.3gppnetwork.org"


def imeisv_from_imei(imei: str) -> str:
    digits = "".join(c for c in str(imei or "") if c.isdigit())
    if not digits:
        return ""
    return digits[:14].ljust(14, "0") + "00"


def build_instance(cfg: dict, card: dict) -> dict:
    """cfg: data/config.yaml 内容；card: sim.read_card() 的 CardInfo.dict()。"""
    # IMEI: 配置优先；为空则在此处稳定生成（以 ICCID/IMSI 派生，多次 provision 不变）
    line = cfg.setdefault("line", {})
    if not line.get("imei"):
        import hashlib
        seed = (card.get("iccid") or card.get("imsi") or "seed").encode()
        digits = str(int.from_bytes(hashlib.sha256(seed).digest()[:8], "big"))
        line["imei"] = "86" + digits[:12].ljust(12, "0") + "5"   # 纯数字 15 位
        cfgmod.save(cfg)
    sip = cfg.get("sip", {})
    bark = dict(cfg.get("bark", {}))
    bark["line_name"] = line.get("name", "") or (card.get("iccid", "")[-6:] and
                                                  f"SIM …{card.get('iccid', '')[-6:]}")
    ports = cfg.get("ports", {})
    rtp_start = int(ports.get("rtp_start", 10000))
    rtp_span = int(ports.get("rtp_span", 60))
    mcc = str(card["mcc"])
    mnc = str(card["mnc"])

    inst = {
        "id": "1",
        "imsi": card["imsi"],
        "mcc": mcc,
        "mnc": mnc,
        "imei": line.get("imei", ""),
        "imeisv": imeisv_from_imei(line.get("imei", "")),
        "pin": line.get("pin", ""),
        "reader": f"imsi:{card['imsi']}",
        "reader_index": int(card.get("reader_index", 0)),
        "reader_port": card.get("reader_port", "") or "",
        "iccid": card.get("iccid", "") or "",
        "msisdn": line.get("msisdn", "") or "",
        "smsc": line.get("smsc", "") or card.get("smsc", "") or "",
        "pcscf": "",
        "ami_user": cfg.get("ami", {}).get("user", "simvowifi"),
        "ami_secret": cfg.get("ami", {}).get("secret", ""),
        # simvowifi 无 manager 控制面，通知全部走 Bark
        "manager_url": "",
        "domain": "",
        "rtp_start": rtp_start,
        "rtp_end": rtp_start + rtp_span - 1,
        "sip": {
            "listen_addr": "0.0.0.0",
            "transport": sip.get("transport", "udp"),
            "udp_port": 5060,
            "tls_port": 5061,
            "external": [
                {
                    "username": sip.get("account", {}).get("username", "linphone"),
                    "password": sip.get("account", {}).get("password", ""),
                }
            ],
            "advertise_address": cfgmod.advertise_address(cfg),
            "ring_timeout": int(sip.get("ring_timeout", 35)),
            "user_agent": sip.get("user_agent", "iOS/26.6 iPhone"),
            "pani_country": line.get("pani_country", ""),
            "pani_country_enable": True,
            # WebRTC 默认关闭（本项目的客户端是 Linphone）
            "webrtc": {"enable": False, "username": "webrtc",
                       "password": "unused", "port": 8089},
        },
        "bark": bark,
        "debug": cfg.get("debug", {"asterisk": True}),
        "rekey_minutes": int(line.get("rekey_minutes", 30)),
        "apn": line.get("apn", "") or "ims",
        "idr_mode": line.get("idr_mode", "") or "apn",
        "cp_mode": line.get("cp_mode", "") or "auto",
        "cp_mode_order": "v6,dual,v4",
        "use_reauth_id": bool(line.get("use_reauth_id", True)),
    }
    return inst


def write_instance(inst: dict) -> str:
    os.makedirs(cfgmod.DATA_DIR, exist_ok=True)
    tmp = cfgmod.INSTANCE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(inst, f, indent=2, ensure_ascii=False)
    os.replace(tmp, cfgmod.INSTANCE_PATH)
    return cfgmod.INSTANCE_PATH
