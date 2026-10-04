"""webui.py — simvowifi Web 管理界面（Flask 单页）。

设计原则：复用 ctl/app 现有模块（dockerops/sms/sim/instance/ami），不重复实现业务逻辑；
WebUI 只做 HTTP 封装 + 一张单页。认证：webui.password（config.yaml）→ 签名 Session Cookie。

运行: simvowifi web   或   python -m app.webui --host 0.0.0.0 --port 8080
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import time

from flask import Flask, jsonify, render_template, request, session

from . import config as cfgmod
from . import dockerops as ops
from . import instance as instmod
from . import sms as smsmod

ANSI = re.compile(r"\x1b\[[0-9;]*m")


# ---------------------------------------------------------------- helpers

def _load_instance() -> dict:
    try:
        with open(cfgmod.INSTANCE_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def _ami_call(fn, *args):
    """连接 AMI 执行一次调用，返回 (ok, detail)。"""
    cfg = cfgmod.load()
    from .ami import Ami
    try:
        with Ami(port=cfg["ami"]["port"], username=cfg["ami"]["user"],
                 secret=cfg["ami"]["secret"]) as a:
            return fn(a, *args)
    except Exception as e:
        return False, f"AMI 连接失败（engine 启动了吗？）: {e}"


def _tail(path: str, n: int = 300) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return "".join(f.readlines()[-n:])
    except FileNotFoundError:
        return ""
    except Exception as e:
        return f"(读取失败: {e!r})"


def _realm() -> str:
    inst = _load_instance()
    if not inst:
        return ""
    try:
        return f"ims.mnc{int(inst['mnc']):03d}.mcc{inst['mcc']}.3gppnetwork.org"
    except Exception:
        return ""


def _epoch_path() -> str:
    return os.path.join(cfgmod.DATA_DIR, "webui.epoch")


def _epoch() -> int:
    try:
        with open(_epoch_path()) as f:
            return int(f.read().strip() or 0)
    except Exception:
        return 0


def _bump_epoch():
    try:
        os.makedirs(cfgmod.DATA_DIR, exist_ok=True)
        with open(_epoch_path(), "w") as f:
            f.write(str(_epoch() + 1))
    except Exception:
        pass


def _current_secret(app_cfg: dict) -> str:
    """secret 由 ami.secret + webui.password + epoch 派生。
    epoch 存在 data/webui.epoch，logout 时递增 → secret 轮换，旧 Cookie 立即作废
    （Flask session 是客户端签名 Cookie，session.clear() 作废不了已签发的旧值）。"""
    return hashlib.sha256(
        ("simvowifi-webui:" + app_cfg.get("ami", {}).get("secret", "") +
         ":" + (app_cfg.get("webui", {}) or {}).get("password", "") +
         ":" + str(_epoch())).encode()).hexdigest()


# ---------------------------------------------------------------- app factory

def create_app() -> Flask:
    cfg = cfgmod.load()
    app = Flask(__name__)
    app.secret_key = _current_secret(cfg)
    app.config.update(SESSION_COOKIE_SAMESITE="Lax", PERMANENT_SESSION_LIFETIME=30 * 86400)

    # -------- 认证门 --------
    @app.before_request
    def _auth():
        # 每次请求重读 secret（含 epoch）：logout 轮换后旧 Cookie 立即失效。
        # 注意：必须在首次访问 session 之前设置，否则会用旧 secret 解开旧 Cookie。
        app.secret_key = _current_secret(cfgmod.load())
        if request.path in ("/api/login",) or request.path.startswith("/static"):
            return None
        if not session.get("auth"):
            if request.path.startswith("/api/"):
                return jsonify(ok=False, error="未登录"), 401
            return render_template("webui.html", logged_in=False)
        return None

    @app.get("/")
    def index():
        return render_template("webui.html", logged_in=True)

    @app.post("/api/login")
    def login():
        pwd = (request.get_json(silent=True) or {}).get("password", "")
        cfg_now = cfgmod.load()
        want = (cfg_now.get("webui", {}) or {}).get("password") or ""
        if not want:
            return jsonify(ok=False, error="webui.password 未配置，先运行 simvowifi init 或编辑 data/config.yaml"), 400
        if pwd != want:
            time.sleep(1.0)   # 轻限速
            return jsonify(ok=False, error="密码错误"), 401
        session.permanent = True
        session["auth"] = True
        return jsonify(ok=True)

    @app.post("/api/logout")
    def logout():
        _bump_epoch()
        session.clear()
        return jsonify(ok=True)

    # -------- 总览 --------
    @app.get("/api/overview")
    def overview():
        inst = _load_instance()
        cs = ops.container_status()
        tun = ops.tunnel_state()
        ims = ops.ims_state()
        lin = _ami_call(lambda a: a.endpoint_online(cfgmod.load().get("sip", {})
                                                    .get("account", {}).get("username", "linphone")))
        cfg = cfgmod.load()
        return jsonify(
            container=cs,
            tunnel=tun,
            ims=ims,
            linphone={"online": bool(lin[0]), "detail": lin[1]},
            events=ops.last_events(12),
            line={
                "imsi": inst.get("imsi", ""), "iccid": inst.get("iccid", ""),
                "msisdn": (cfg.get("line", {}).get("msisdn") or inst.get("msisdn", "")),
                "epdg": inst.get("epdg", ""), "cp_mode": inst.get("cp_mode", ""),
                "imei": inst.get("imei", ""), "name": cfg.get("line", {}).get("name", ""),
            },
            bark_configured=bool(cfg.get("bark", {}).get("key")),
            provisioned=bool(inst),
        )

    # -------- 短信 --------
    @app.get("/api/sms")
    def sms_list():
        limit = int(request.args.get("limit", 100))
        return jsonify(messages=smsmod.list_messages(limit))

    @app.post("/api/sms")
    def sms_send():
        body = request.get_json(silent=True) or {}
        to, text = (body.get("to") or "").strip(), (body.get("text") or "").strip()
        if not to or not text:
            return jsonify(ok=False, error="号码和内容不能为空"), 400
        inst = _load_instance()
        if not inst:
            return jsonify(ok=False, error="未开通（先 provision）"), 400

        def _send(a):
            return a.send_sms(to, text, inst.get("msisdn", ""), _realm())
        ok_flag, detail = _ami_call(_send)
        return jsonify(ok=ok_flag, detail=detail)

    # -------- 呼叫 --------
    @app.post("/api/call")
    def call():
        to = (request.get_json(silent=True) or {}).get("to", "").strip()
        if not to:
            return jsonify(ok=False, error="号码不能为空"), 400
        inst = _load_instance()
        if not inst:
            return jsonify(ok=False, error="未开通（先 provision）"), 400
        user = cfgmod.load().get("sip", {}).get("account", {}).get("username", "linphone")

        def _orig(a):
            return a.originate(to, user, inst.get("msisdn", ""))
        ok_flag, detail = _ami_call(_orig)
        return jsonify(ok=ok_flag, detail=detail)

    # -------- Bark --------
    @app.post("/api/bark_test")
    def bark_test():
        cfg = cfgmod.load()
        b = cfg.get("bark", {})
        if not b.get("key"):
            return jsonify(ok=False, error="bark.key 未配置"), 400
        good, detail = smsmod.bark_test(b.get("server", "https://api.day.app"), b["key"])
        return jsonify(ok=good, detail=detail)

    # -------- 读卡器 / 开通 --------
    @app.get("/api/readers")
    def readers():
        from . import sim
        try:
            return jsonify(readers=sim.list_readers())
        except Exception as e:
            return jsonify(readers=[], error=str(e))

    @app.post("/api/provision")
    def provision():
        from . import sim
        body = request.get_json(silent=True) or {}
        try:
            rs = sim.list_readers()
        except Exception as e:
            return jsonify(ok=False, error=f"pcscd 不可用: {e}"), 400
        if not rs:
            return jsonify(ok=False, error="未发现读卡器"), 400
        idx = int(body.get("reader", 0))
        if idx >= len(rs):
            return jsonify(ok=False, error=f"读卡器序号越界: {idx}"), 400
        cfg = cfgmod.load()
        pin = cfg.get("line", {}).get("pin") or None
        try:
            card = sim.read_card(idx, pin)
            d = card.dict() if hasattr(card, "dict") else card
        except Exception as e:
            return jsonify(ok=False, error=f"读卡失败: {e}"), 400
        if not d.get("present", True):
            return jsonify(ok=False, error="读卡器里没有卡"), 400
        if not d.get("imsi"):
            return jsonify(ok=False, error=f"读卡失败（要 PIN? 是 USIM?）: {d.get('error', '未知')}"), 400
        inst = instmod.build_instance(cfg, d)
        instmod.write_instance(inst)
        return jsonify(ok=True, card=d,
                       instance={"imsi": inst["imsi"], "epdg": inst["epdg"],
                                 "cp_mode": inst["cp_mode"], "imei": inst["imei"]})

    # -------- 配置 --------
    @app.get("/api/config")
    def get_config():
        try:
            with open(cfgmod.CONFIG_PATH, encoding="utf-8") as f:
                return jsonify(yaml=f.read())
        except FileNotFoundError:
            return jsonify(yaml="", error="config.yaml 不存在（先 simvowifi init）")

    @app.post("/api/config")
    def set_config():
        import yaml
        text = (request.get_json(silent=True) or {}).get("yaml", "")
        try:
            parsed = yaml.safe_load(text)
            if not isinstance(parsed, dict):
                raise ValueError("顶层必须是映射")
        except Exception as e:
            return jsonify(ok=False, error=f"YAML 无效: {e}"), 400
        cfgmod.save(parsed)
        return jsonify(ok=True, note="已保存。engine 重启后生效（部分项需 simvowifi provision 重生成 instance）")

    # -------- 日志 --------
    @app.get("/api/logs")
    def logs():
        which = request.args.get("which", "entrypoint")
        tail = min(int(request.args.get("tail", 300)), 2000)
        base = cfgmod.DATA_DIR
        if which == "entrypoint":
            if shutil.which("docker"):
                p = subprocess.run(["docker", "logs", "--tail", str(tail), "simvowifi-engine"],
                                   capture_output=True, text=True, timeout=15)
                return jsonify(log=ANSI.sub("", p.stdout + p.stderr)[-tail * 200:])
            return jsonify(log="(docker 不可用)")
        if which == "asterisk":
            for cand in ("logs/messages", "logs/full"):
                t = _tail(os.path.join(base, cand), tail)
                if t:
                    return jsonify(log=t)
            return jsonify(log="(暂无 Asterisk 日志文件)")
        if which == "charon":
            return jsonify(log=_tail(os.path.join(base, "run", "charon.log"), tail) or "(暂无 IKE 日志——隧道未启动过)")
        if which == "events":
            evs = ops.last_events(tail)
            return jsonify(log="\n".join(json.dumps(e, ensure_ascii=False) for e in evs) or "(暂无事件)")
        return jsonify(log=f"未知日志类型: {which}"), 400

    # -------- 生命周期 --------
    @app.post("/api/lifecycle")
    def lifecycle():
        action = (request.get_json(silent=True) or {}).get("action", "")
        try:
            if action == "start":
                if not os.path.exists(cfgmod.INSTANCE_PATH):
                    return jsonify(ok=False, error="未开通（先 provision）"), 400
                return jsonify(ok=True, detail=ops.up())
            if action == "stop":
                return jsonify(ok=True, detail=ops.down())
            if action == "restart":
                if not os.path.exists(cfgmod.INSTANCE_PATH):
                    return jsonify(ok=False, error="未开通（先 provision）"), 400
                ops.down()
                return jsonify(ok=True, detail=ops.up())
        except Exception as e:
            return jsonify(ok=False, error=repr(e)), 500
        return jsonify(ok=False, error=f"未知动作: {action}"), 400

    # -------- 诊断 --------
    @app.get("/api/doctor")
    def doctor():
        import socket
        items = []

        def add(level, msg):
            items.append({"level": level, "msg": msg})

        if shutil.which("docker"):
            p = subprocess.run(["docker", "info"], capture_output=True)
            add("ok" if p.returncode == 0 else "bad",
                "Docker daemon " + ("运行中" if p.returncode == 0 else "未运行"))
            add("ok" if os.popen("docker images -q simvowifi/engine:latest 2>/dev/null").read().strip() else "warn",
                "engine 镜像 " + ("已构建" if os.popen("docker images -q simvowifi/engine:latest 2>/dev/null").read().strip() else "未构建 → simvowifi build"))
        else:
            add("bad", "Docker 未安装")
        add("ok" if os.path.exists("/dev/net/tun") else "bad",
            "/dev/net/tun " + ("可用" if os.path.exists("/dev/net/tun") else "缺失"))
        p = subprocess.run(["systemctl", "is-active", "pcscd"], capture_output=True, text=True)
        if "active" in (p.stdout or ""):
            v = subprocess.run(["pcscd", "--version"], capture_output=True, text=True)
            ver = (v.stdout or "").splitlines()[0].split()[-1] if v.stdout else "?"
            add("ok", f"pcscd 运行中（{ver}）")
        else:
            add("warn", "pcscd 未运行")
        try:
            from . import sim
            rs = sim.list_readers()
            add("ok" if rs else "warn", f"读卡器 {len(rs)} 个" + (f": {rs[0]}" if rs else "（未插入）"))
        except Exception:
            add("warn", "读卡器查询失败（pcscd?）")
        inst = _load_instance()
        if inst:
            host = inst.get("epdg") or instmod.epdg_fqdn(inst["mcc"], inst["mnc"])
            try:
                addr = socket.getaddrinfo(host, None)[0][4][0]
                if addr == "127.0.0.1":
                    add("bad", f"ePDG 解析得 127.0.0.1 哨兵值: {host} —— 手动指定 line.epdg")
                else:
                    add("ok", f"ePDG 可解析: {host} → {addr}")
            except socket.gaierror:
                add("bad", f"ePDG 无法解析: {host}")
        else:
            add("warn", "未 provision")
        cfg = cfgmod.load()
        add("ok" if cfg.get("bark", {}).get("key") else "warn",
            "Bark key " + ("已配置" if cfg.get("bark", {}).get("key") else "未配置"))
        return jsonify(items=items)

    # -------- Linphone 接入信息 --------
    @app.get("/api/linphone")
    def linphone():
        cfg = cfgmod.load()
        sip = cfg.get("sip", {})
        acc = sip.get("account", {})
        return jsonify(
            server=cfgmod.advertise_address(cfg),
            port=5060, transport=sip.get("transport", "udp"),
            username=acc.get("username", "linphone"),
            password=acc.get("password", ""),
            realm="sip." + (_realm() or ""),
        )

    return app


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description="simvowifi WebUI")
    ap.add_argument("--host", default=None)
    ap.add_argument("--port", type=int, default=None)
    args = ap.parse_args(argv)
    cfg = cfgmod.load()
    wcfg = cfg.get("webui", {}) or {}
    host = args.host or wcfg.get("host", "0.0.0.0")
    port = args.port or int(wcfg.get("port", 8080))
    app = create_app()
    print(f"simvowifi WebUI → http://{host}:{port}  (密码见 data/config.yaml 的 webui.password)")
    app.run(host=host, port=port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
