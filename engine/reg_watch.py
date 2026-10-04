#!/usr/bin/env python3
"""
reg_watch.py — simvowifi 新增：IMS 注册状态监视器。

上游 vowifi_gateway 由控制面 manager 轮询 AMI 检测注册状态；simvowifi 无 manager，
因此在 engine 容器内用本脚本监视 Asterisk，状态变化时：
  1. 写 /run/vowifi/ims_status.json （simvowifi status 读取）
  2. 调 notify.py registered / unregistered （→ Bark 推送）

用法: reg_watch.py [间隔秒数，默认 15]
"""
import json
import os
import subprocess
import sys
import time

RUNDIR = os.environ.get("VOWIFI_RUNDIR", "/run/vowifi")
STATUS_FILE = os.path.join(RUNDIR, "ims_status.json")
NOTIFY = os.environ.get("SWU_NOTIFY", "/usr/local/bin/notify.py")


def registered_state() -> str:
    """Registered | Rejected | Unregistered"""
    try:
        out = subprocess.run(["asterisk", "-rx", "pjsip show registrations"],
                             capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return "unknown"
    for line in out.splitlines():
        if "volte_ims" in line:
            if "Registered" in line:
                return "Registered"
            if "Rejected" in line:
                return "Rejected"
            if any(s in line for s in ("Requesting", "Unregistered", "Provisioning")):
                return "Unregistered"
    return "unknown"


def publish(state: str):
    try:
        os.makedirs(RUNDIR, exist_ok=True)
        tmp = STATUS_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"state": state, "since": int(time.time())}, f)
        os.replace(tmp, STATUS_FILE)
    except Exception:
        pass


def fire(event: str):
    try:
        subprocess.Popen([sys.executable, NOTIFY, event],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def main():
    interval = int(sys.argv[1]) if len(sys.argv) > 1 else 15
    last = None
    print("[reg_watch] watching IMS registration...", flush=True)
    while True:
        state = registered_state()
        if state != last:
            print(f"[reg_watch] {last} -> {state}", flush=True)
            publish(state)
            if state == "Registered":
                fire("registered")
            elif last == "Registered" and state in ("Unregistered", "Rejected"):
                fire("unregistered")
            last = state
        time.sleep(interval)


if __name__ == "__main__":
    main()
