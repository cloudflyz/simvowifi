"""webui.py — simvowifi Web 管理界面（React SPA + JSON API）。

前端: webui/（Vite + React，布局/主题/软电话封装改编自 pagecat/vowifi_gateway webui，MIT）。
      构建产物 webui/dist 由本服务静态托管；仓库已包含 dist，无需 Node 即可部署。
      开发: cd webui && npm install && npm run dev（vite 把 /api 代理到 localhost:8080）。
后端: 复用 ctl/app 现有模块（dockerops/sms/calls/sim/instance/ami），只做 HTTP 封装，
      不重复实现业务逻辑。认证: webui.password（config.yaml）→ 签名 Session Cookie；
      未登录时 /api/* 一律 401，由 SPA 渲染登录页。

运行: simvowifi web   或   python -m app.webui --host 0.0.0.0 --port 8080
TLS:  webui.tls: true 时用 data/certs 自签名证书提供 HTTPS（浏览器软电话麦克风必需）。
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time

from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.exceptions import NotFound

from . import config as cfgmod
from . import dockerops as ops
from . import instance as instmod
from . import sms as smsmod

WEBUI_DIST = os.path.join(cfgmod.REPO, "webui", "dist")
VERSION = "2.0"


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


def _bump_epoch() -> int:
    # 注意：先读旧值再打开写（"w" 会先清空文件，若在 write 里才读 _epoch()
    # 会读到刚被清空的 0，导致 epoch 永远停在 1）
    new = _epoch() + 1
    try:
        os.makedirs(cfgmod.DATA_DIR, exist_ok=True)
        with open(_epoch_path(), "w") as f:
            f.write(str(new))
    except Exception:
        pass
    return new


def _current_secret(app_cfg: dict) -> str:
    """secret 由 ami.secret + webui.password 派生。登录态的有效性另由 session 内的
    epoch 值控制（见 _auth / _bump_epoch）：logout 递增 data/webui.epoch 后，
    所有已签发 Cookie 立即作废（Flask session 是客户端签名 Cookie，
    session.clear() 作废不了已签发给客户端的旧值；而 secret 只能在
    请求上下文建立前读取，运行中轮换不影响本请求，故用 epoch 值校验）。"""
    return hashlib.sha256(
        ("simvowifi-webui:" + app_cfg.get("ami", {}).get("secret", "") +
         ":" + (app_cfg.get("webui", {}) or {}).get("password", "")).encode()).hexdigest()


def _ensure_cert() -> tuple[str, str] | None:
    """TLS 需要的证书（与 engine SIP-TLS 共用 data/certs/）。缺失则生成。"""
    crt = os.path.join(cfgmod.DATA_DIR, "certs", "certificate.crt")
    key = os.path.join(cfgmod.DATA_DIR, "certs", "certificate.key")
    if os.path.exists(crt) and os.path.exists(key):
        return crt, key
    os.makedirs(os.path.dirname(crt), exist_ok=True)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                    "-keyout", key, "-out", crt, "-days", "3650",
                    "-subj", "/CN=simvowifi.local"],
                   capture_output=True, text=True)
    if os.path.exists(crt) and os.path.exists(key):
        return crt, key
    return None


# ---------------------------------------------------------------- app factory

def create_app() -> Flask:
    cfg = cfgmod.load()
    tls = bool((cfg.get("webui", {}) or {}).get("tls"))
    app = Flask(__name__, static_folder=WEBUI_DIST, static_url_path="/static")
    app.secret_key = _current_secret(cfg)
    app.config.update(SESSION_COOKIE_SAMESITE="Lax",
                      SESSION_COOKIE_SECURE=tls,
                      PERMANENT_SESSION_LIFETIME=30 * 86400)

    # -------- 认证门 --------
    @app.before_request
    def _auth():
        # 登录态 = session.auth 且 epoch 与 data/webui.epoch 一致。
        # logout 递增 epoch → 所有已签发 Cookie 立即作废。
        valid = session.get("auth") and session.get("epoch") == _epoch()
        if (not valid) and request.path.startswith("/api/") \
                and request.path not in ("/api/login", "/api/session"):
            return jsonify(ok=False, error="未登录"), 401
        return None

    @app.get("/")
    def index():
        try:
            return send_from_directory(WEBUI_DIST, "index.html")
        except NotFound:
            return ("<html><head><meta charset='utf-8'></head><body style='font-family:"
                    "system-ui;padding:40px;line-height:1.8'>"
                    "<h2>simvowifi WebUI 未构建</h2>"
                    "<p>缺少 <code>webui/dist</code>。两种方式：</p>"
                    "<p>1) 开发模式：<code>cd webui &amp;&amp; npm install &amp;&amp; "
                    "npm run dev</code>（浏览器开 vite 地址）</p>"
                    "<p>2) 构建静态产物：<code>cd webui &amp;&amp; npm install &amp;&amp; "
                    "npm run build</code></p></body></html>"), 503

    @app.get("/assets/<path:fn>")
    def asset(fn):
        # vite base:'./' → index.html 引用 ./assets/...（相对于 /，即 /assets/...）
        try:
            return send_from_directory(WEBUI_DIST, "assets/" + fn)
        except NotFound:
            return "", 404

    @app.get("/api/session")
    def session_info():
        cfg_now = cfgmod.load()
        valid = session.get("auth") and session.get("epoch") == _epoch()
        return jsonify(auth=bool(valid),
                       tls=request.is_secure,
                       webui_tls=bool((cfg_now.get("webui", {}) or {}).get("tls")),
                       version=VERSION)

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
        session["epoch"] = _epoch()
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
                "smsc": inst.get("smsc", ""),
            },
            bark_configured=bool(cfg.get("bark", {}).get("key")),
            bark_encrypted=bool(((cfg.get("bark", {}) or {}).get("encrypt") or {}).get("key")),
            provisioned=bool(inst),
        )

    # -------- 短信 --------
    @app.get("/api/sms")
    def sms_list():
        limit = int(request.args.get("limit", 200))
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

    @app.post("/api/sms/delete")
    def sms_delete():
        sel = request.get_json(silent=True) or {}
        if not (sel.get("ids") or sel.get("peer") or sel.get("all")):
            return jsonify(ok=False, error="需要 ids / peer / all 之一"), 400
        n = smsmod.delete_messages(sel)
        return jsonify(ok=True, deleted=n)

    # -------- 通话记录 / 外呼 --------
    @app.get("/api/calls")
    def calls_list():
        from . import calls
        return jsonify(calls=calls.list_calls(int(request.args.get("limit", 100))))

    @app.post("/api/calls/delete")
    def calls_delete():
        from . import calls
        sel = request.get_json(silent=True) or {}
        if not (sel.get("ids") or sel.get("all")):
            return jsonify(ok=False, error="需要 ids / all 之一"), 400
        n = calls.delete_calls(sel)
        return jsonify(ok=True, deleted=n)

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

    # -------- 浏览器软电话（WebRTC over WSS）--------
    @app.get("/api/softphone")
    def softphone():
        cfg = cfgmod.load()
        wr = (cfg.get("sip", {}).get("webrtc") or {})
        host = (request.host or "").split(":")[0]
        return jsonify(
            enabled=bool(wr.get("enable")),
            username=wr.get("username", "webrtc"),
            password=wr.get("password", ""),
            ws_port=int(wr.get("port", 8089)),
            host=host,
            realm=_realm(),
            provisioned=bool(_load_instance()),
            running=bool(ops.container_status().get("running")),
        )

    @app.post("/api/webrtc")
    def set_webrtc():
        enable = bool((request.get_json(silent=True) or {}).get("enable"))
        cfg = cfgmod.load()
        cfg.setdefault("sip", {}).setdefault("webrtc", {})
        cfg["sip"]["webrtc"]["enable"] = enable
        cfgmod.save(cfg)
        return jsonify(ok=True, note=(
            "已保存。生效步骤：SIM 开通页重新 provision → 总览页重启 engine → "
            "浏览器用 HTTPS 访问 WebUI（设置页可开启 HTTPS），并先访问 "
            "https://<服务器>:8089/ 接受一次自签名证书。"))

    # -------- WebUI HTTPS --------
    @app.post("/api/webui_tls")
    def set_webui_tls():
        enable = bool((request.get_json(silent=True) or {}).get("enable"))
        if enable and not _ensure_cert():
            return jsonify(ok=False, error="证书生成失败（openssl? 先运行 simvowifi init）"), 500
        cfg = cfgmod.load()
        cfg.setdefault("webui", {})["tls"] = enable
        cfgmod.save(cfg)
        return jsonify(ok=True, note="已保存。重启 WebUI 后生效：systemctl restart simvowifi-web（或重新 simvowifi web），然后用 https:// 打开。")

    # -------- Bark --------
    @app.post("/api/bark_test")
    def bark_test():
        cfg = cfgmod.load()
        b = cfg.get("bark", {})
        if not b.get("key"):
            return jsonify(ok=False, error="bark.key 未配置"), 400
        good, detail = smsmod.bark_test(b.get("server", "https://api.day.app"), b["key"], bark_cfg=b)
        return jsonify(ok=good, detail=detail)

    @app.get("/api/bark_settings")
    def bark_settings_get():
        b = cfgmod.load().get("bark", {}) or {}
        enc = b.get("encrypt") or {}
        return jsonify(
            server=b.get("server", "https://api.day.app"),
            key=b.get("key", ""),
            group=b.get("group", "VoIP"),
            include_body=bool(b.get("include_body", True)),
            call_sound=b.get("call_sound", "alarm"),
            call_level=b.get("call_level", "critical"),
            call_group=b.get("call_group", ""),
            call_isArchive=int(b.get("call_isArchive", 1)),
            encrypt={
                "algorithm": str(enc.get("algorithm", "AES128")),
                "mode": str(enc.get("mode", "CBC")),
                "key": str(enc.get("key", "")),
                "iv": str(enc.get("iv", "")),
            },
        )

    @app.post("/api/bark_settings")
    def bark_settings_post():
        """保存 Bark 设置（含推送加密）。校验后合并进 config.yaml 的 bark 段。"""
        from . import barkcrypt
        d = request.get_json(silent=True) or {}
        enc_in = d.get("encrypt") or {}
        enc = {
            "algorithm": str(enc_in.get("algorithm", "AES128")).upper(),
            "mode": str(enc_in.get("mode", "CBC")).upper(),
            "key": str(enc_in.get("key", "")),
            "iv": str(enc_in.get("iv", "")),
        }
        if enc["key"]:
            err = barkcrypt.validate(enc["algorithm"], enc["mode"], enc["key"], enc["iv"])
            if err:
                return jsonify(ok=False, error=f"加密配置无效: {err}"), 400
        else:
            enc["iv"] = ""  # 未启用加密时 iv 无意义
        server = str(d.get("server") or "").strip()
        if server:
            if not server.startswith(("http://", "https://")):
                return jsonify(ok=False, error="server 必须以 http(s):// 开头"), 400

        cfg = cfgmod.load()
        b = cfg.setdefault("bark", {})
        if server:  # 部分更新：未提供的字段不覆盖
            b["server"] = server
        if "key" in d:
            b["key"] = str(d.get("key") or "").strip()
        if "group" in d:
            b["group"] = str(d.get("group") or "VoIP")
        if "include_body" in d:
            b["include_body"] = bool(d.get("include_body"))
        if "call_sound" in d:
            b["call_sound"] = str(d.get("call_sound") or "alarm")
        if "call_level" in d:
            b["call_level"] = str(d.get("call_level") or "critical")
        if "call_group" in d:
            b["call_group"] = str(d.get("call_group") or "")
        if "call_isArchive" in d:
            b["call_isArchive"] = int(d.get("call_isArchive", 1))
        b["encrypt"] = enc
        cfgmod.save(cfg)
        return jsonify(ok=True, note="已保存。engine 推送需重启后生效；测试推送立即按新配置发送。")

    # -------- 读卡器 / 开通 / PIN --------
    @app.get("/api/readers")
    def readers():
        from . import sim
        try:
            return jsonify(readers=sim.list_readers())
        except Exception as e:
            return jsonify(readers=[], error=str(e))

    @app.get("/api/card")
    def card():
        """读卡（检测）。用 config 的 line.pin（若有）自动验证。"""
        from . import sim
        idx = int(request.args.get("reader", 0))
        cfg = cfgmod.load()
        pin = cfg.get("line", {}).get("pin") or None
        try:
            c = sim.read_card(idx, pin)
            return jsonify(c.dict() if hasattr(c, "dict") else c)
        except Exception as e:
            return jsonify(error=repr(e)), 500

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
        # 开通时允许带上本次会话验证过的 PIN（不落盘，除非本就写在配置里）
        pin = (body.get("pin") or "").strip() or pin
        try:
            c = sim.read_card(idx, pin)
            d = c.dict() if hasattr(c, "dict") else c
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

    @app.post("/api/sim/verify_pin")
    def sim_verify_pin():
        from . import sim
        d = request.get_json(silent=True) or {}
        pin = str(d.get("pin") or "").strip()
        if not pin.isdigit() or not (4 <= len(pin) <= 8):
            return jsonify(ok=False, error="PIN 必须是 4-8 位数字"), 400
        try:
            return jsonify(sim.verify_pin(pin, int(d.get("reader", 0))))
        except Exception as e:
            return jsonify(ok=False, error=repr(e)), 500

    @app.post("/api/sim/change_pin")
    def sim_change_pin():
        from . import sim
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(sim.change_pin(str(d.get("old") or ""), str(d.get("new") or ""),
                                          int(d.get("reader", 0))))
        except Exception as e:
            return jsonify(ok=False, error=repr(e)), 500

    @app.post("/api/sim/pin_enabled")
    def sim_pin_enabled():
        from . import sim
        d = request.get_json(silent=True) or {}
        try:
            return jsonify(sim.set_pin_enabled(str(d.get("pin") or ""),
                                               bool(d.get("enabled")),
                                               int(d.get("reader", 0))))
        except Exception as e:
            return jsonify(ok=False, error=repr(e)), 500

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

    # -------- 日志（保留 ANSI 颜色，前端渲染）--------
    @app.get("/api/logs")
    def logs():
        which = request.args.get("which", "entrypoint")
        tail = min(int(request.args.get("tail", 300)), 2000)
        base = cfgmod.DATA_DIR
        if which == "entrypoint":
            if shutil.which("docker"):
                try:
                    p = subprocess.run(["docker", "logs", "--tail", str(tail), "simvowifi-engine"],
                                       capture_output=True, text=True, timeout=15)
                    return jsonify(log=(p.stdout or "") + (p.stderr or ""))
                except subprocess.TimeoutExpired:
                    return jsonify(log="(docker logs 超时)")
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
    if wcfg.get("tls"):
        pair = _ensure_cert()
        if pair:
            print(f"simvowifi WebUI → https://{host}:{port}  "
                  f"(自签名证书；密码见 data/config.yaml 的 webui.password)")
            app.run(host=host, port=port, threaded=True, debug=False,
                    ssl_context=(pair[0], pair[1]))
            return
        print("警告: webui.tls 开启但证书不可用，回退 HTTP")
    print(f"simvowifi WebUI → http://{host}:{port}  (密码见 data/config.yaml 的 webui.password)")
    app.run(host=host, port=port, threaded=True, debug=False)


if __name__ == "__main__":
    main()
