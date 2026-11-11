"""esim.py — eSIM 管理服务层（WebUI / CLI 共用）。

职责：
  * 解析读卡器（与 sim.py 一致的编号）
  * 串行化 lpac 调用（PC/SC 同一时刻只允许一个持有者）
  * 把 lpa.py 的异常收敛成可展示的错误

不直接读卡时不加锁；只有真正调用 lpac 的操作才进锁。
"""
from __future__ import annotations

import threading

from . import lpa

_LOCK = threading.Lock()


def available() -> bool:
    return lpa.lpac_available()


def _reader_name(reader_index: int = 0) -> str:
    from . import sim
    readers = sim.list_readers()
    if reader_index < 0 or reader_index >= len(readers):
        raise lpa.LpaError(f"reader index 越界（共 {len(readers)} 个读卡器）")
    return readers[reader_index]


def state(reader_index: int = 0) -> dict:
    """读取 eUICC 概览：SE、EID、profile 列表、通知。"""
    if not available():
        return {"available": False, "error": "lpac 未安装",
                "ses": [], "dual": False, "reader": None}
    name = _reader_name(reader_index)
    with _LOCK:
        out = lpa.load_all_ses(name, reader_index)
    out["available"] = True
    out["reader"] = name
    return out


def profile_action(reader_index: int, iccid: str, action: str,
                   *, aid: str | None = None, nickname: str | None = None) -> dict:
    name = _reader_name(reader_index)
    with _LOCK:
        if action == "enable":
            lpa.profile_enable(name, iccid, aid=aid)
        elif action == "disable":
            lpa.profile_disable(name, iccid, aid=aid)
        elif action == "delete":
            lpa.profile_delete(name, iccid, aid=aid)
        elif action == "nickname":
            if not nickname:
                raise lpa.LpaError("nickname 不能为空")
            lpa.profile_nickname(name, iccid, nickname, aid=aid)
        else:
            raise lpa.LpaError(f"未知操作: {action}")
    return {"ok": True, "action": action, "iccid": iccid}


def download(reader_index: int, *, activation_code: str | None = None,
             smdp: str | None = None, matching_id: str | None = None,
             confirmation_code: str | None = None, imei: str | None = None,
             aid: str | None = None) -> dict:
    name = _reader_name(reader_index)
    with _LOCK:
        data = lpa.download(
            name,
            activation_code=activation_code, smdp=smdp, matching_id=matching_id,
            confirmation_code=confirmation_code, imei=imei, aid=aid,
        )
    return {"ok": True, "data": data}


def notifications(reader_index: int, *, process: bool = False,
                  seq: int | None = None, aid: str | None = None) -> dict:
    name = _reader_name(reader_index)
    with _LOCK:
        if process:
            data = lpa.notification_process(name, seq, all_notifications=seq is None, aid=aid)
            return {"ok": True, "data": data}
        return {"ok": True, "notifications": lpa.notification_list(name, aid=aid)}
