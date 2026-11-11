"""lpa.py — lpac 二进制封装（eSIM / eUICC 管理）。

移植自 mdd-sim-gateway 的 `control/app/lpa.py`（GPLv3），做了两处适配：
  * asyncio → 同步 subprocess（simvowifi 是 Flask 单线程化调用，不需要事件循环）
  * 配置读取改为 simvowifi 的 data/config.yaml（`esim:` 段）

lpac 通过 PC/SC 访问读卡器，和引擎/WebUI 读卡互斥，调用方负责加锁。
"""
from __future__ import annotations

import json
import logging
import os
import select
import signal
import subprocess
import time

log = logging.getLogger("simvowifi.esim.lpa")


class LpaError(Exception):
    """lpac 返回非成功载荷、超时，或无法启动。"""

    def __init__(self, message: str, *, detail=None, code: int = -1):
        super().__init__(message)
        self.message = message
        self.detail = detail
        self.code = code

    def user_message(self) -> str:
        msg = (self.message or "").strip().lower()
        detail = self.detail
        if isinstance(detail, str):
            detail_s = detail.strip()
        elif detail not in (None, "", {}):
            detail_s = str(detail)
        else:
            detail_s = ""
        if msg.startswith("euicc_init"):
            return "这张卡不是 eUICC/eSIM，普通 USIM 无法在这里管理。"
        if msg in ("cancelled", "cancel"):
            return "操作已取消。"
        if "timed out" in msg:
            return "eSIM 操作超时，请重试。"
        if detail_s:
            return f"{self.message}: {detail_s}"
        return f"eUICC 操作失败（{self.message}）。"


class LpaResult:
    def __init__(self):
        self.data = None
        self.progress: list[dict] = []


# ---------------------------------------------------------------- config

def _esim_cfg() -> dict:
    from . import config as cfgmod
    try:
        return (cfgmod.load().get("esim") or {})
    except Exception:
        return {}


def lpac_bin() -> str:
    cfg = _esim_cfg()
    path = (cfg.get("lpac_bin") or "").strip()
    if path:
        return path
    packaged = "/usr/local/bin/lpac"
    if os.path.isfile(packaged):
        return packaged
    from . import config as cfgmod
    return os.path.join(cfgmod.DATA_DIR, "lpac", "lpac")


def lpac_available() -> bool:
    b = lpac_bin()
    return os.path.isfile(b) and os.access(b, os.X_OK)


def download_timeout() -> float:
    try:
        return float(_esim_cfg().get("download_timeout") or 300)
    except (TypeError, ValueError):
        return 300.0


def auto_process_notifications() -> bool:
    return bool(_esim_cfg().get("auto_process_notifications", True))


def _env_for_reader(reader_name: str | None, aid: str | None = None) -> dict:
    env = os.environ.copy()
    env["LPAC_APDU"] = "pcsc"
    env["LPAC_HTTP"] = "curl"
    env.pop("LPAC_APDU_PCSC_DRV_IFID", None)
    env.pop("DRIVER_IFID", None)
    if reader_name:
        env["LPAC_APDU_PCSC_DRV_NAME"] = reader_name
    else:
        env.pop("LPAC_APDU_PCSC_DRV_NAME", None)
        env.pop("DRIVER_NAME", None)
    aid_n = (aid or "").strip().upper().replace(" ", "")
    if aid_n:
        env["LPAC_CUSTOM_ISD_R_AID"] = aid_n
    else:
        env.pop("LPAC_CUSTOM_ISD_R_AID", None)
    return env


# ---------------------------------------------------------------- runner

def run_lpac(
    *args: str,
    reader_name: str | None = None,
    aid: str | None = None,
    timeout: float | None = None,
    stdin_data: str | None = None,
) -> LpaResult:
    """执行 `lpac <args>`，返回最终 lpa 载荷。失败抛 LpaError。"""
    binary = lpac_bin()
    if not os.path.isfile(binary):
        raise LpaError(
            f"找不到 lpac（{binary}）。运行 install.sh build-lpac 或配置 esim.lpac_bin。")
    if not os.access(binary, os.X_OK):
        raise LpaError(f"lpac 没有可执行权限: {binary}")

    cmd = [binary, *args]
    env = _env_for_reader(reader_name, aid=aid)
    log.info("lpac reader=%s custom_aid=%s op=%s", reader_name or "*", bool(aid),
             " ".join(args[:2]))

    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            stdin=subprocess.PIPE if stdin_data is not None else subprocess.DEVNULL,
            env=env, text=True, bufsize=1,
        )
    except OSError as e:
        raise LpaError(f"无法启动 lpac: {e}") from e

    if stdin_data is not None and proc.stdin:
        try:
            proc.stdin.write(stdin_data)
            proc.stdin.close()
        except Exception:  # noqa
            pass

    result = LpaResult()
    final = None
    stderr_txt = ""
    deadline = (time.monotonic() + timeout) if timeout else None

    try:
        assert proc.stdout is not None
        while True:
            if deadline is not None:
                remain = deadline - time.monotonic()
                if remain <= 0:
                    _signal_cancel(proc)
                    raise LpaError("lpac timed out")
                r, _, _ = select.select([proc.stdout], [], [], remain)
                if not r:
                    _signal_cancel(proc)
                    raise LpaError("lpac timed out")
            line = proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            typ = obj.get("type")
            if typ == "progress":
                p = obj.get("payload") or {}
                result.progress.append({
                    "step": p.get("message") or "",
                    "data": p.get("data"),
                    "code": p.get("code", 0),
                })
            elif typ == "lpa":
                final = obj.get("payload") or {}

        rc = proc.wait(timeout=10)
        if proc.stderr:
            stderr_txt = (proc.stderr.read() or "").strip()
    finally:
        if proc.poll() is None:
            _signal_cancel(proc)
        for f in (proc.stdout, proc.stderr):
            try:
                f and f.close()
            except Exception:  # noqa
                pass

    if final is None:
        raise LpaError(f"lpac 没有返回结果（{stderr_txt or f'exit={rc}'}）", code=rc or -1)

    code = int(final.get("code", -1))
    message = final.get("message") or ("success" if code == 0 else "error")
    if code != 0:
        detail = final.get("data") if final.get("data") not in (None, "", {}) else (
            stderr_txt or None)
        raise LpaError(str(message), detail=detail, code=code)

    result.data = final.get("data")
    return result


def _signal_cancel(proc: subprocess.Popen):
    if proc.poll() is not None:
        return
    try:
        proc.send_signal(signal.SIGINT)
    except Exception:  # noqa
        try:
            proc.kill()
        except Exception:  # noqa
            pass


# ---------------------------------------------------------------- 高层操作

def chip_info(reader_name: str, *, aid: str | None = None) -> dict:
    r = run_lpac("chip", "info", reader_name=reader_name, aid=aid, timeout=60)
    d = r.data or {}
    eid = d.get("eidValue") or d.get("eid") or ""
    addrs = d.get("EuiccConfiguredAddresses") or {}
    info2 = d.get("EUICCInfo2") or {}
    ext = info2.get("extCardResource") or {}
    return {
        "eid": eid,
        "defaultDpAddress": addrs.get("defaultDpAddress"),
        "rootDsAddress": addrs.get("rootDsAddress"),
        "freeNonVolatileMemory": ext.get("freeNonVolatileMemory"),
        "freeVolatileMemory": ext.get("freeVolatileMemory"),
        "sasAccreditationNumber": (
            info2.get("sasAccreditationNumber") or info2.get("sasAcreditationNumber")),
        "raw": d,
    }


def profile_list(reader_name: str, *, aid: str | None = None) -> list[dict]:
    r = run_lpac("profile", "list", reader_name=reader_name, aid=aid, timeout=60)
    return r.data if isinstance(r.data, list) else []


def profile_enable(reader_name: str, iccid: str, *, aid: str | None = None):
    r = run_lpac("profile", "enable", iccid, reader_name=reader_name, aid=aid, timeout=120)
    maybe_process_notifications(reader_name, aid=aid)
    return r.data


def profile_disable(reader_name: str, iccid: str, *, aid: str | None = None):
    r = run_lpac("profile", "disable", iccid, reader_name=reader_name, aid=aid, timeout=120)
    maybe_process_notifications(reader_name, aid=aid)
    return r.data


def profile_delete(reader_name: str, iccid: str, *, aid: str | None = None):
    r = run_lpac("profile", "delete", iccid, reader_name=reader_name, aid=aid, timeout=120)
    maybe_process_notifications(reader_name, aid=aid)
    return r.data


def profile_nickname(reader_name: str, iccid: str, nickname: str, *, aid: str | None = None):
    r = run_lpac("profile", "nickname", iccid, nickname,
                 reader_name=reader_name, aid=aid, timeout=60)
    return r.data


def download(
    reader_name: str,
    *,
    activation_code: str | None = None,
    smdp: str | None = None,
    matching_id: str | None = None,
    confirmation_code: str | None = None,
    imei: str | None = None,
    aid: str | None = None,
    interactive_preview: bool = False,
    stdin_data: str | None = None,
):
    args = ["profile", "download"]
    if activation_code:
        args += ["-a", activation_code]
    else:
        if smdp:
            args += ["-s", smdp]
        if matching_id:
            args += ["-m", matching_id]
    if confirmation_code:
        args += ["-c", confirmation_code]
    if imei:
        args += ["-i", imei]
    if interactive_preview:
        args += ["-p"]
    r = run_lpac(*args, reader_name=reader_name, aid=aid,
                 timeout=download_timeout(), stdin_data=stdin_data)
    maybe_process_notifications(reader_name, aid=aid)
    return r.data


def discovery(reader_name: str, *, imei: str | None = None, smds: str | None = None,
              aid: str | None = None):
    args = ["profile", "discovery"]
    if smds:
        args += ["-s", smds]
    if imei:
        args += ["-i", imei]
    return run_lpac(*args, reader_name=reader_name, aid=aid, timeout=120).data


def notification_list(reader_name: str, *, aid: str | None = None) -> list[dict]:
    r = run_lpac("notification", "list", reader_name=reader_name, aid=aid, timeout=60)
    return r.data if isinstance(r.data, list) else []


def notification_process(reader_name: str, seq: int | None = None, *,
                         all_notifications: bool = False, autoremove: bool = True,
                         aid: str | None = None):
    args = ["notification", "process"]
    if all_notifications:
        args.append("-a")
    if autoremove:
        args.append("-r")
    if seq is not None and not all_notifications:
        args.append(str(seq))
    return run_lpac(*args, reader_name=reader_name, aid=aid, timeout=180).data


def notification_remove(reader_name: str, seq: int | None = None, *,
                        all_notifications: bool = False, aid: str | None = None):
    args = ["notification", "remove"]
    if all_notifications:
        args.append("-a")
    elif seq is not None:
        args.append(str(seq))
    return run_lpac(*args, reader_name=reader_name, aid=aid, timeout=60).data


def maybe_process_notifications(reader_name: str, *, aid: str | None = None) -> None:
    """SGP.22 通知投递，失败只记日志。"""
    if not auto_process_notifications():
        return
    try:
        notification_process(reader_name, all_notifications=True, autoremove=True, aid=aid)
    except LpaError as e:
        log.warning("自动处理通知失败 reader=%s: %s (%s)", reader_name, e.message, e.detail)
    except Exception as e:  # noqa
        log.warning("自动处理通知异常 reader=%s: %r", reader_name, e)


def load_all_ses(reader_name: str, reader_index: int = 0) -> dict:
    """探测 SE，并加载每个 SE 的 chip 信息、profile 与通知。"""
    from . import estkme

    ses = estkme.discover_ses(reader_name, reader_index)
    out: list[dict] = []
    for se in ses:
        aid = se.get("aid")
        entry = {
            "id": se["id"], "label": se["label"], "aid": aid,
            "eid": None, "freeSpace": None,
            "defaultDpAddress": None, "rootDsAddress": None,
            "profiles": [], "notifications": [], "error": None,
        }
        try:
            chip = chip_info(reader_name, aid=aid)
            entry.update(
                eid=chip.get("eid") or None,
                freeSpace=chip.get("freeNonVolatileMemory"),
                defaultDpAddress=chip.get("defaultDpAddress"),
                rootDsAddress=chip.get("rootDsAddress"),
                chip=chip,
            )
            for p in profile_list(reader_name, aid=aid):
                if isinstance(p, dict):
                    p = {**p, "seId": se["id"], "seLabel": se["label"],
                         "seEid": entry["eid"]}
                entry["profiles"].append(p)
            try:
                notes = notification_list(reader_name, aid=aid)
            except LpaError:
                notes = []
            for n in notes:
                if isinstance(n, dict):
                    n = {**n, "seId": se["id"], "seLabel": se["label"],
                         "seEid": entry["eid"]}
                entry["notifications"].append(n)
        except LpaError as e:
            entry["error"] = e.user_message()
            log.info("SE %s 读取失败 reader=%s: %s", se["id"], reader_name, e.message)
        out.append(entry)
    return {"ses": out, "dual": len(out) > 1}
