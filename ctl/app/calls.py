"""calls.py — 通话记录（engine /logs/calls.txt + logs/events.jsonl 关联）。

calls.txt 由拨号计划在呼叫建立时追加（单行，无结果）：
    IN call from <号码> at 2026-10-05 12:00:00
    OUT call to <号码> at 2026-10-05 12:00:00

结果由 notify.py 写 events.jsonl（无时间戳）：
    {"event": "call_result", "args": ["in"|"out", <peer>, <DIALSTATUS>, <HANGUPCAUSE>]}

list_calls 把两者按 (方向, 号码) FIFO 关联：calls.txt 提供时间线，
每个 call_result 事件匹配同方向同号码的最早未决记录。
"""
from __future__ import annotations

import json
import os
import re

from . import config as cfgmod

CALL_RE = re.compile(
    r"^(IN|OUT) call (?:from|to) (\S+) at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")

# Asterisk DIALSTATUS → 记录状态
STATUS = {
    "ANSWER": "answered",
    "BUSY": "busy",
    "NOANSWER": "noanswer",
    "CANCEL": "cancelled",
    "CONGESTION": "congestion",
    "CHANUNAVAIL": "unavailable",
    "INVALIDARGS": "failed",
    "DONTCALL": "rejected",
    "TORTURE": "rejected",
}


def _calls_path() -> str:
    return os.path.join(cfgmod.DATA_DIR, "logs", "calls.txt")


def _events_path() -> str:
    return os.path.join(cfgmod.DATA_DIR, "logs", "events.jsonl")


def _read_call_results() -> list[tuple[str, str, str]]:
    """[(dir, peer, status), ...] — 按写入顺序。"""
    out = []
    try:
        with open(_events_path(), encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("event") != "call_result":
                    continue
                args = e.get("args") or []
                if len(args) >= 3:
                    d = str(args[0]).lower()
                    out.append((d, str(args[1]), STATUS.get(str(args[2]), str(args[2]))))
    except FileNotFoundError:
        pass
    except Exception:
        pass
    return out


def list_calls(limit: int = 100) -> list[dict]:
    path = _calls_path()
    records: list[dict] = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = CALL_RE.match(line.strip())
                if not m:
                    continue
                d = m.group(1).lower()
                records.append({"id": len(records), "dir": d,
                                "peer": m.group(2), "time": m.group(3),
                                "status": None})
    except FileNotFoundError:
        return []
    except Exception:
        return []

    # FIFO 关联结果：同 (dir, peer) 的最早未决记录先消费
    pending: dict[tuple[str, str], list[int]] = {}
    for i, r in enumerate(records):
        pending.setdefault((r["dir"], r["peer"]), []).append(i)
    for d, peer, status in _read_call_results():
        q = pending.get((d, peer))
        if q:
            records[q.pop(0)]["status"] = status

    out = []
    for r in records:
        s = r["status"]
        r["status"] = s or "ringing"
        r["answered"] = s == "answered"
        out.append(r)
    return out[-limit:][::-1]  # 最新的在前


def delete_calls(sel: dict) -> int:
    """删除通话记录行。sel: {ids:[...]} | {all:True}。结果事件留在 events.jsonl（无害）。"""
    path = _calls_path()
    if not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    ids = set(int(i) for i in (sel.get("ids") or []))
    drop_all = bool(sel.get("all"))
    kept, ri, dropped = [], 0, 0
    for line in lines:
        if CALL_RE.match(line.strip()):
            if drop_all or ri in ids:
                dropped += 1
            else:
                kept.append(line)
            ri += 1
        else:
            kept.append(line)
    if not dropped:
        return 0
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.writelines(kept)
    os.replace(tmp, path)
    return dropped
