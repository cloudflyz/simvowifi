"""cli.py — simvowifi 命令行控制面。

命令一览:
  init                 初始化 data/config.yaml + 自签名证书
  doctor               环境体检（docker/tun/pcscd/读卡器/ePDG/Bark）
  readers              列出 PC/SC 读卡器
  provision [-r N]     读 SIM 卡 → 生成 engine 配置 instance.json
  start|stop|restart   启停 engine 容器
  status               容器/隧道/IMS 注册/Linphone 在线状态
  logs [-f]            engine 日志
  sms list [N]         最近短信
  sms send NUM TEXT    发短信（经 IMS 线路）
  call NUM             外呼（先振铃 Linphone，接听后桥接）
  bark test            发送 Bark 测试推送
  linphone             打印 iOS Linphone 配置参数
  info                 当前线路配置摘要
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import socket
import string
import subprocess
import sys

from . import config as cfgmod
from . import dockerops as ops
from . import instance as instmod
from . import sms as smsmod


def ok(msg): print(f"  \033[32m✓\033[0m {msg}")
def warn(msg): print(f"  \033[33m⚠\033[0m {msg}")
def bad(msg): print(f"  \033[31m✗\033[0m {msg}")
def info(msg): print(f"  · {msg}")


# ---------------------------------------------------------------- init

def cmd_init(args):
    if os.path.exists(cfgmod.CONFIG_PATH):
        print(f"配置已存在: {cfgmod.CONFIG_PATH}（如需重置请先删除）")
    else:
        cfgmod.save(cfgmod.default_config())
        ok(f"已生成配置 {cfgmod.CONFIG_PATH}")
        warn("请编辑该文件填写 bark.key（Bark App 里复制）、line.pin 等")
    cfgmod.ensure_dirs()

    # 自签名证书（pjsip tls transport 用；即使默认 udp 也先生成，compose 挂载不缺文件）
    crt = os.path.join(cfgmod.DATA_DIR, "certs", "certificate.crt")
    key = os.path.join(cfgmod.DATA_DIR, "certs", "certificate.key")
    if not os.path.exists(crt):
        r = subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                            "-keyout", key, "-out", crt, "-days", "3650",
                            "-subj", "/CN=simvowifi.local"],
                           capture_output=True, text=True)
        if r.returncode == 0:
            ok("已生成自签名证书 (data/certs/)")
        else:
            warn(f"openssl 生成证书失败: {r.stderr.strip()[:120]}（用 tls 传输时才需要）")
    print("\n下一步:")
    print("  1. 编辑 data/config.yaml（bark.key、line.pin 等）")
    print("  2. 插入 SIM 读卡器 → simvowifi provision")
    print("  3. simvowifi start && simvowifi status")


# ---------------------------------------------------------------- doctor

def cmd_doctor(args):
    print("simvowifi 环境体检\n" + "=" * 40)

    # Docker
    if shutil.which("docker"):
        p = subprocess.run(["docker", "info"], capture_output=True, text=True)
        if p.returncode == 0:
            ok("Docker 已安装且 daemon 运行中")
            img = subprocess.run(["docker", "images", "-q", ops.IMAGE],
                                 capture_output=True, text=True)
            if img.stdout.strip():
                ok(f"engine 镜像 {ops.IMAGE} 已构建")
            else:
                warn(f"engine 镜像未构建 → 运行: simvowifi build（约 10-20 分钟）")
        else:
            bad("Docker daemon 未运行: systemctl start docker")
    else:
        bad("Docker 未安装 → 重新运行 ./install.sh 或 curl -fsSL https://get.docker.com | sh")

    # /dev/net/tun
    if os.path.exists("/dev/net/tun"):
        ok("/dev/net/tun 可用")
    else:
        bad("/dev/net/tun 不存在（容器内 ePDG 隧道必需）")

    # pcscd
    p = subprocess.run(["systemctl", "is-active", "pcscd"], capture_output=True, text=True)
    if "active" in (p.stdout or ""):
        ok("pcscd 服务运行中")
    elif shutil.which("pcscd") or os.path.exists("/usr/sbin/pcscd"):
        warn("pcscd 未运行 → systemctl enable --now pcscd")
    else:
        bad("pcscd 未安装 → apt install pcscd pcsc-tools")

    # 读卡器
    try:
        from . import sim
        rs = sim.list_readers()
        if rs:
            ok(f"读卡器 x{len(rs)}:")
            for i, r in enumerate(rs):
                info(f"[{i}] {r}")
        else:
            warn("未发现读卡器（插入 USB CCID 读卡器 + SIM）")
    except ImportError:
        bad("pyscard 未安装 → 重新运行 ./install.sh")
    except Exception as e:
        warn(f"读卡器检测失败: {e!r}")

    # 已配置线路 → 检查 ePDG DNS / Bark
    if os.path.exists(cfgmod.CONFIG_PATH):
        cfg = cfgmod.load()
        if os.path.exists(cfgmod.INSTANCE_PATH):
            with open(cfgmod.INSTANCE_PATH) as f:
                inst = json.load(f)
            host = instmod.epdg_fqdn(inst["mcc"], inst["mnc"])
            try:
                socket.getaddrinfo(host, None)
                ok(f"ePDG 域名可解析: {host}")
            except socket.gaierror:
                bad(f"ePDG 域名无法解析: {host}（网络/DNS 问题）")
        bark = cfg.get("bark", {})
        if bark.get("key"):
            good, detail = smsmod.bark_test(bark.get("server", "https://api.day.app"), bark["key"])
            (ok if good else bad)(f"Bark 推送{'正常' if good else '失败'}: {detail}")
        else:
            warn("bark.key 未配置（iOS Bark App → 复制 key 填入 data/config.yaml）")
    print("=" * 40)


# ---------------------------------------------------------------- readers / provision

def cmd_readers(args):
    from . import sim
    rs = sim.list_readers()
    if not rs:
        print("未发现读卡器。检查: lsusb / systemctl status pcscd")
        return 1
    for i, r in enumerate(rs):
        print(f"[{i}] {r}")
        try:
            from . import usbreader
            port = usbreader.port_for_index(i)
            if port:
                print(f"     物理端口: {port}")
        except Exception:
            pass


def cmd_provision(args):
    from . import sim
    cfg = cfgmod.load()
    rs = sim.list_readers()
    if not rs:
        bad("未发现读卡器（pcscd 运行了吗？SIM 插好了吗？）")
        return 1
    idx = args.reader
    if idx is None or idx >= len(rs):
        if len(rs) == 1:
            idx = 0
        else:
            for i, r in enumerate(rs):
                print(f"[{i}] {r}")
            try:
                idx = int(input("选择读卡器序号: ").strip())
            except ValueError:
                bad("无效序号")
                return 1

    pin = cfg.get("line", {}).get("pin", "") or None
    info(f"读取读卡器 [{idx}] {rs[idx]} …")
    card = sim.read_card(idx, pin)
    d = card.dict() if hasattr(card, "dict") else card
    if not d.get("present", True):
        bad(f"读卡器里没有卡: {d.get('error', '')}")
        return 1
    if not d.get("imsi"):
        bad(f"读卡失败（是否需要 PIN？是否为 USIM?）: {d.get('error', '未知错误')}")
        return 1

    print("\n── SIM 信息 " + "─" * 28)
    print(f"  IMSI   : {d['imsi']}  (MCC {d['mcc']} / MNC {d['mnc']})")
    print(f"  ICCID  : {d.get('iccid', '?')}")
    print(f"  SMSC   : {d.get('smsc') or '(卡内未存，稍后在 config 填 line.smsc)'}")
    print(f"  PIN    : {'已启用, 剩余尝试 ' + str(d.get('pin_tries')) if d.get('pin_enabled') else '未启用'}")
    host = instmod.epdg_fqdn(d["mcc"], d["mnc"])
    print(f"  ePDG   : {host}")
    try:
        socket.getaddrinfo(host, None)
        ok("ePDG 域名可解析")
    except socket.gaierror:
        bad("ePDG 域名无法解析——该运营商可能不支持 VoWiFi 或需自填 line.epdg")

    # IMEI: 配置优先，否则生成并回存（保持稳定——换 IMEI 可能被运营商风控）
    line = cfg.setdefault("line", {})
    if not line.get("imei"):
        line["imei"] = "86" + "".join(secrets.choice(string.digits) for _ in range(12)) + \
                       str(secrets.randbelow(10))
        cfgmod.save(cfg)
        warn(f"已随机生成 IMEI={line['imei']}（若有备用真机 IMEI，建议手动替换）")
    if d.get("smsc") and not line.get("smsc"):
        line["smsc"] = d["smsc"]
        cfgmod.save(cfg)
        ok(f"SMSC 已写入配置: {d['smsc']}")

    inst = instmod.build_instance(cfg, d)
    path = instmod.write_instance(inst)
    ok(f"engine 配置已生成: {path}")
    print("\n下一步: simvowifi start && simvowifi status && simvowifi linphone")


# ---------------------------------------------------------------- lifecycle

def _need_instance():
    if not os.path.exists(cfgmod.INSTANCE_PATH):
        bad("未找到 instance.json — 先运行: simvowifi provision")
        raise SystemExit(1)
    if os.path.isdir(cfgmod.INSTANCE_PATH):
        bad("instance.json 是个目录！可能是 provision 之前手动 up 过容器，"
            "Docker 自动建了空目录。删除后重新 provision: "
            f"rm -rf {cfgmod.INSTANCE_PATH}")
        raise SystemExit(1)
    for f in ("certs/certificate.crt", "certs/certificate.key"):
        p = os.path.join(cfgmod.DATA_DIR, f)
        if not os.path.isfile(p):
            bad(f"缺少 {p} — 先运行: simvowifi init")
            raise SystemExit(1)


def cmd_start(args):
    _need_instance()
    cfgmod.ensure_dirs()
    print(ops.up())
    print("容器启动中（隧道+IMS 注册约需 30-90 秒）→ simvowifi status 查看")


def cmd_stop(args):
    print(ops.down())


def cmd_restart(args):
    _need_instance()
    print(ops.down())
    print(ops.up())


def cmd_status(args):
    cs = ops.container_status()
    print(f"容器     : {cs['status']}")
    ts = ops.tunnel_state()
    state = ts.get("state", "UNKNOWN")
    color = "\033[32m" if state == "CONNECTED" else "\033[31m"
    print(f"ePDG 隧道: {color}{state}\033[0m")
    if cs["running"]:
        ims = ops.ims_state().get("state", "unknown")
        if ims != "unknown":
            c = "\033[32m" if ims == "Registered" else "\033[31m"
            print(f"IMS 注册 : {c}{ims}\033[0m （reg_watch）")
        cfg = cfgmod.load()
        from .ami import Ami
        try:
            with Ami(port=cfg["ami"]["port"], username=cfg["ami"]["user"],
                     secret=cfg["ami"]["secret"]) as ami:
                reg = ami.ims_registered()
                c = "\033[32m" if reg == "Registered" else "\033[31m"
                print(f"IMS 注册 : {c}{reg}\033[0m （AMI 实时）")
                online, detail = ami.endpoint_online(cfg["sip"]["account"]["username"])
                c = "\033[32m" if online else "\033[33m"
                print(f"Linphone : {c}{'在线' if online else '未注册/离线'}\033[0m")
                if detail:
                    print(f"           {detail}")
        except Exception as e:
            warn(f"AMI 查询失败: {e!r}")
    evs = ops.last_events(6)
    if evs:
        print("最近事件:")
        for e in evs:
            print(f"  {e.get('event', '?'):14} {' '.join(e.get('args', []))[:60]}")


def cmd_logs(args):
    ops.logs(follow=args.follow, tail=args.tail)


# ---------------------------------------------------------------- sms / call

def _ami():
    cfg = cfgmod.load()
    from .ami import Ami
    a = Ami(port=cfg["ami"]["port"], username=cfg["ami"]["user"], secret=cfg["ami"]["secret"])
    a.connect()
    return a, cfg


def cmd_sms_list(args):
    msgs = smsmod.list_messages(args.limit)
    if not msgs:
        print("（暂无短信——收到后会显示在这里并推送到 Bark）")
        return
    for m in msgs:
        arrow = "↙ 收" if m["dir"] == "IN" else "↗ 发"
        print(f"{arrow} {m['peer']}  {m['time']}")
        print(f"   {m['body'][:200]}")
        print()


def cmd_sms_send(args):
    _need_instance()
    try:
        ami, cfg = _ami()
    except Exception as e:
        bad(f"连接 AMI 失败（engine 启动了吗?）: {e!r}")
        return 1
    with open(cfgmod.INSTANCE_PATH) as f:
        inst = json.load(f)
    ok_flag, detail = ami.send_sms(args.to, args.text,
                                   inst.get("msisdn", ""),
                                   f"ims.mnc{int(inst['mnc']):03d}.mcc{inst['mcc']}.3gppnetwork.org")
    (ok if ok_flag else bad)(f"短信发送{'成功' if ok_flag else '失败'}: {detail}")


def cmd_call(args):
    _need_instance()
    try:
        ami, cfg = _ami()
    except Exception as e:
        bad(f"连接 AMI 失败（engine 启动了吗?）: {e!r}")
        return 1
    with open(cfgmod.INSTANCE_PATH) as f:
        inst = json.load(f)
    print(f"正在振铃 Linphone（{cfg['sip']['account']['username']}），接听后拨出 {args.to} …")
    ok_flag, detail = ami.originate(args.to, cfg["sip"]["account"]["username"],
                                    inst.get("msisdn", ""))
    (ok if ok_flag else bad)(f"外呼{'已发起' if ok_flag else '失败'}: {detail}")


# ---------------------------------------------------------------- bark / linphone / info

def cmd_bark_test(args):
    cfg = cfgmod.load()
    bark = cfg.get("bark", {})
    if not bark.get("key"):
        bad("bark.key 未配置（Bark App → 复制 key → data/config.yaml）")
        return 1
    good, detail = smsmod.bark_test(bark.get("server", "https://api.day.app"), bark["key"])
    (ok if good else bad)(f"测试推送{'已发送' if good else '失败'}: {detail}")


def cmd_linphone(args):
    cfg = cfgmod.load()
    acc = cfg["sip"]["account"]
    ip = cfgmod.advertise_address(cfg)
    tp = cfg["sip"].get("transport", "udp")
    port = 5061 if tp == "tls" else 5060
    print("═" * 52)
    print("iOS Linphone 配置（App Store 下载 Linphone）")
    print("═" * 52)
    print("""
1. 打开 Linphone → 设置 → 管理 SIP 账户 → + 新建 SIP 账户
   用户名 : {user}
   密码   : {pw}
   域名   : {ip}
   传输   : {tp}   （端口 {port}）
   显示名 : 随意

2. 高级设置（建议）:
   - 传输 = {tp}
   - NAT/防火墙: 保持默认（同局域网无需 STUN）
   - AVPF/ICE: 关闭（服务器侧不需要）

3. 测试:
   - 拨号盘输入号码（如 +8613xxxxxxxxx）→ 呼出
   - 用另一台手机拨打 SIM 号码 → Bark 推送 + Linphone 振铃
   - 收发短信: Linphone 聊天页直接发（走 IMS 短信）

⚠️ iOS 后台限制: Linphone 退到后台后 SIP 注册可能被系统挂起，
   来电主要靠 Bark 推送唤醒（建议开启 Bark「重要告警」授权，
   来电推送即使静音也会响铃）。收短信同样有 Bark 推送兜底。
""".format(user=acc["username"], pw=acc["password"], ip=ip, tp=tp.upper(), port=port))


def cmd_info(args):
    cfg = cfgmod.load()
    print(f"配置文件 : {cfgmod.CONFIG_PATH}")
    if os.path.exists(cfgmod.INSTANCE_PATH):
        with open(cfgmod.INSTANCE_PATH) as f:
            inst = json.load(f)
        print(f"IMSI     : {inst['imsi']}")
        print(f"ICCID    : {inst.get('iccid', '?')}")
        print(f"ePDG     : {instmod.epdg_fqdn(inst['mcc'], inst['mnc'])}")
        print(f"本机号码 : {inst.get('msisdn') or '(未设置 line.msisdn)'}")
        print(f"SMSC     : {inst.get('smsc') or '(未设置!)'}")
        print(f"IMEI     : {inst.get('imei')}")
    else:
        print("instance.json 不存在（先 provision）")
    acc = cfg["sip"]["account"]
    print(f"Linphone : {acc['username']} @ {cfgmod.advertise_address(cfg)} ({cfg['sip']['transport']})")
    print(f"Bark     : {'已配置' if cfg['bark'].get('key') else '未配置'}")


# ---------------------------------------------------------------- build

def cmd_build(args):
    print(f"构建 engine 镜像 {ops.IMAGE}（编译 Asterisk，约 10-20 分钟）…")
    good, output = ops.build_engine()
    if good:
        ok("构建完成")
    else:
        bad("构建失败，最后 30 行输出:")
        print("\n".join(output.splitlines()[-30:]))
        return 1


# ---------------------------------------------------------------- parser

def main(argv=None):
    ap = argparse.ArgumentParser(prog="simvowifi",
                                 description="SIM → VoWiFi → SIP 网关（Linphone + Bark）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="初始化配置").set_defaults(func=cmd_init)
    sub.add_parser("doctor", help="环境体检").set_defaults(func=cmd_doctor)
    sub.add_parser("readers", help="列出读卡器").set_defaults(func=cmd_readers)

    p = sub.add_parser("provision", help="读 SIM → 生成 engine 配置")
    p.add_argument("-r", "--reader", type=int, default=None, metavar="N")
    p.set_defaults(func=cmd_provision)

    for name, fn, h in (("start", cmd_start, "启动"), ("stop", cmd_stop, "停止"),
                        ("restart", cmd_restart, "重启")):
        sub.add_parser(name, help=h).set_defaults(func=fn)

    sub.add_parser("status", help="运行状态").set_defaults(func=cmd_status)

    p = sub.add_parser("logs", help="engine 日志")
    p.add_argument("-f", "--follow", action="store_true")
    p.add_argument("--tail", type=int, default=100)
    p.set_defaults(func=cmd_logs)

    p = sub.add_parser("sms", help="短信")
    s2 = p.add_subparsers(dest="sms_cmd", required=True)
    ps = s2.add_parser("list", help="最近短信: sms list [N]")
    ps.add_argument("limit", nargs="?", type=int, default=20)
    ps.set_defaults(func=cmd_sms_list)
    p2 = s2.add_parser("send", help="发短信: sms send <号码> <内容>")
    p2.add_argument("to")
    p2.add_argument("text")
    p2.set_defaults(func=cmd_sms_send)

    p = sub.add_parser("call", help="外呼（振铃 Linphone 后桥接）")
    p.add_argument("to")
    p.set_defaults(func=cmd_call)

    pb = sub.add_parser("bark", help="Bark 推送")
    pb2 = pb.add_subparsers(dest="bark_cmd", required=True)
    pb2.add_parser("test", help="测试推送").set_defaults(func=cmd_bark_test)

    sub.add_parser("linphone", help="iOS Linphone 配置指引").set_defaults(func=cmd_linphone)
    sub.add_parser("info", help="线路配置摘要").set_defaults(func=cmd_info)
    sub.add_parser("build", help="构建 engine 镜像").set_defaults(func=cmd_build)

    args = ap.parse_args(argv)
    rc = args.func(args)
    sys.exit(rc or 0)


if __name__ == "__main__":
    main()
