"""dockerops.py — 通过 docker compose / docker CLI 管理 engine 容器。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

from . import config as cfgmod

CONTAINER = "simvowifi-engine"
IMAGE = os.environ.get("SIMVOWIFI_ENGINE_IMAGE", "simvowifi/engine:latest")


def _compose_args() -> list[str]:
    env = dict(os.environ)
    env["SIMVOWIFI_DATA_DIR"] = cfgmod.DATA_DIR
    return env


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    if not shutil.which(cmd[0]):
        # docker 未安装：返回等价的失败结果而不是抛异常
        return subprocess.CompletedProcess(cmd, 127, "", f"{cmd[0]}: command not found（未安装 Docker？）")
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def compose(*args, check: bool = True) -> subprocess.CompletedProcess:
    env = _compose_args()
    cmd = ["docker", "compose", "-f", cfgmod.COMPOSE_FILE, *args]
    p = run(cmd, env=env)
    if check and p.returncode != 0:
        print(p.stderr or p.stdout, file=sys.stderr)
        raise RuntimeError(f"docker compose {' '.join(args)} 失败 (code {p.returncode})")
    return p


def build_engine() -> tuple[bool, str]:
    """构建 engine 镜像（编译 Asterisk，首次约 10-20 分钟）。"""
    p = run(["docker", "build", "-t", IMAGE,
             os.path.join(cfgmod.REPO, "engine")], timeout=None)
    return p.returncode == 0, (p.stdout or "") + (p.stderr or "")


def up() -> str:
    compose("up", "-d")
    return "started"


def down() -> str:
    compose("down")
    return "stopped"


def container_status() -> dict:
    p = run(["docker", "ps", "-a", "--filter", f"name={CONTAINER}",
             "--format", "{{.Names}}\t{{.Status}}"])
    line = (p.stdout or "").strip().splitlines()
    if not line:
        return {"running": False, "status": "未创建（先 simvowifi start）"}
    status = line[0].split("\t")[-1] if "\t" in line[0] else line[0]
    return {"running": "Up" in status, "status": status}


def logs(follow: bool = False, tail: int = 100) -> None:
    if not shutil.which("docker"):
        print("未安装 Docker。", file=sys.stderr)
        return
    args = ["docker", "logs", "--tail", str(tail)]
    if follow:
        args.append("-f")
    try:
        subprocess.run(args + [CONTAINER])
    except KeyboardInterrupt:
        pass


def tunnel_state() -> dict:
    """engine 的 swu_ike 发布的隧道状态文件（bind mount 的 run/ 目录）。"""
    path = os.path.join(cfgmod.DATA_DIR, "run", "swu_status.json")
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {"state": "UNKNOWN"}


def ims_state() -> dict:
    """reg_watch.py 写的 IMS 注册状态文件（bind mount 的 run/ 目录）。"""
    path = os.path.join(cfgmod.DATA_DIR, "run", "ims_status.json")
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {"state": "unknown"}


def last_events(n: int = 8) -> list[dict]:
    path = os.path.join(cfgmod.DATA_DIR, "logs", "events.jsonl")
    try:
        with open(path) as f:
            lines = f.readlines()[-n:]
        return [json.loads(x) for x in lines if x.strip()]
    except Exception:
        return []
