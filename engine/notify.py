#!/usr/bin/env python3
"""
notify.py - Best-effort event hook: POST engine events to the manager.

Usage (from the Asterisk dialplan or swu_ike tunnel hooks):
  notify.py <event> [arg1] [arg2] ...

Events: call_in <from>, call_out <to>, sms_in <from> <body_b64>,
        sms_out <to> <body_b64>, tunnel_up, tunnel_down, registered, unregistered

Reads MANAGER_URL and VOWIFI_ID from /run/vowifi/engine.env (written by render.py).
Never fails the caller (all exceptions swallowed).
"""
import os
import sys
import json


def load_env():
    env = {}
    path = os.environ.get("VOWIFI_ENV", "/run/vowifi/engine.env")
    try:
        with open(path) as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    env[k] = v
    except Exception:
        pass
    return env


def bark_dispatch(event, args, env):
    """simvowifi: 将事件转为 Bark 推送（best-effort，绝不抛异常）。
    call_in <from> / sms_in <from> <body_b64> / tunnel_down / registered 等。"""
    try:
        import bark  # 同目录 /usr/local/bin
        title = body = ""
        if event == "call_in":
            title = f"\U0001F4DE 来电 {args[0]}"
            body = f"{args[0]} 呼叫你的 SIM 线路，点开通知唤起 Linphone 接听"
        elif event == "sms_in":
            frm = args[0] if args else ""
            text = ""
            if len(args) > 1 and args[1]:
                try:
                    import base64
                    text = base64.b64decode(args[1]).decode("utf-8", "replace")
                except Exception:
                    text = ""
            title = f"\U0001F4E9 短信 {frm}"
            body = text or "（空短信）"
        elif event == "tunnel_down":
            title = "\u26A0\uFE0F simvowifi 隧道断开"
            body = "ePDG 隧道已断开，引擎将自动重连"
        elif event == "registered":
            title = "\u2705 simvowifi IMS 已注册"
            body = "线路已就绪，可以接打电话/收发短信"
        elif event == "unregistered":
            title = "\u26A0\uFE0F simvowifi IMS 注册失效"
            body = "引擎将自动重新注册"
        else:
            return
        bark.notify(event, title, body, env=env)
    except Exception:
        pass


def main():
    if len(sys.argv) < 2:
        return
    event = sys.argv[1]
    args = sys.argv[2:]
    env = load_env()
    manager_url = os.environ.get("MANAGER_URL") or env.get("MANAGER_URL", "")
    inst_id = os.environ.get("VOWIFI_ID") or env.get("VOWIFI_ID", "1")
    payload = {"instance": inst_id, "event": event, "args": args}
    # Always append to a local event log so nothing is lost if the manager is down.
    try:
        os.makedirs("/logs", exist_ok=True)
        with open("/logs/events.jsonl", "a") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass
    # simvowifi: Bark 推送（独立于 manager，可单独启用/禁用）
    bark_dispatch(event, args, env)
    if not manager_url:
        return
    try:
        import requests
        import urllib3
        urllib3.disable_warnings()
        requests.post(f"{manager_url.rstrip('/')}/api/engine/event",
                      json=payload, timeout=3, verify=False)
    except Exception:
        pass


if __name__ == "__main__":
    main()
