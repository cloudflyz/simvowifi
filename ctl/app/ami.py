"""ami.py — 极简同步 Asterisk AMI 客户端（标准库 socket，无第三方依赖）。

只做 CLI 需要的三件事：
  - login / 发送任意 action
  - 查询 IMS 注册状态、Linphone 在线状态（pjsip show registrations / contacts）
  - 发短信（MessageSend）、外呼（Originate）
"""
from __future__ import annotations

import socket
import time


class Ami:
    def __init__(self, host: str = "127.0.0.1", port: int = 5038,
                 username: str = "", secret: str = "", timeout: float = 8.0):
        self.host, self.port = host, int(port)
        self.username, self.secret = username, secret
        self.timeout = timeout
        self.sock: socket.socket | None = None
        self.buf = b""

    # ---------- 底层 ----------

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        self.sock.settimeout(self.timeout)
        # 问候语: "Asterisk Call Manager/x.y\r\n"
        self._read_line()
        res = self.action({"Action": "Login", "Username": self.username,
                           "Secret": self.secret})
        if not res.get("Response", "").lower().startswith("success"):
            raise RuntimeError(f"AMI 登录失败: {res.get('Message', res)}")

    def close(self):
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass
        self.sock = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *a):
        self.close()

    def _read_line(self) -> str:
        while b"\r\n" not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("AMI 连接被关闭")
            self.buf += chunk
        line, self.buf = self.buf.split(b"\r\n", 1)
        return line.decode("utf-8", "replace")

    def _read_packet(self) -> dict:
        # 键去空白；Command 响应的重复 Output 行累积到 _outputs
        pkt: dict[str, str] = {}
        outputs: list[str] = []
        while True:
            line = self._read_line()
            if line == "":
                if outputs:
                    pkt["_outputs"] = outputs
                return pkt
            if ": " in line:
                k, v = line.split(": ", 1)
                k = k.strip()
                if k == "Output":
                    outputs.append(v)
                elif k not in pkt:      # 重复键保留首个
                    pkt[k] = v
            elif line.endswith(":"):
                pkt[line[:-1].strip()] = ""

    def action(self, fields: dict) -> dict:
        """发送 action 并返回首个响应包（后续 event 包丢弃）。"""
        if not self.sock:
            raise ConnectionError("AMI 未连接")
        data = "".join(f"{k}: {v}\r\n" for k, v in fields.items()) + "\r\n"
        self.sock.sendall(data.encode("utf-8"))
        while True:
            pkt = self._read_packet()
            if "Response" in pkt:
                return pkt
            # 事件包（Event: ...）在响应之前到达时跳过

    def command(self, cmd: str) -> str:
        """执行 CLI 命令，拼接所有输出行。"""
        res = self.action({"Action": "Command", "Command": cmd})
        chunks: list[str] = list(res.get("_outputs", []))
        # Command 的输出可能跨多个包（--END COMMAND-- 结束）
        deadline = time.monotonic() + self.timeout
        while not any("END COMMAND" in c for c in chunks):
            if time.monotonic() > deadline:
                break
            try:
                pkt = self._read_packet()
            except (socket.timeout, TimeoutError, ConnectionError):
                break
            chunks.extend(pkt.get("_outputs", []))
            if pkt.get("Response") and not pkt.get("_outputs"):
                break
        return "\n".join(chunks)

    # ---------- 业务 ----------

    def ims_registered(self) -> str:
        """返回 volte_ims 注册状态: Registered / Unregistered / Rejected / unknown。"""
        try:
            text = self.command("pjsip show registrations")
        except Exception:
            return "unknown"
        for line in text.splitlines():
            if "volte_ims" in line:
                if "Registered" in line:
                    return "Registered"
                if "Rejected" in line:
                    return "Rejected"
                if ("Requesting" in line or "Unregistered" in line
                        or "Provisioning" in line):
                    return "Unregistered"
        return "unknown"

    def endpoint_online(self, endpoint: str = "linphone") -> tuple[bool, str]:
        """本地 SIP 账号（Linphone）是否在线。返回 (在线, 详情行)。"""
        try:
            text = self.command("pjsip show contacts")
        except Exception:
            return False, ""
        for line in text.splitlines():
            if endpoint in line.lower():
                return ("Avail" in line, line.strip())
        return False, ""

    def send_sms(self, to: str, body: str, msisdn: str, realm: str) -> tuple[bool, str]:
        """经 volte_ims 线路发短信（与拨号计划 MessageSend 相同语义）。"""
        res = self.action({
            "Action": "MessageSend",
            "To": f"pjsip:volte_ims/{to}@volte_ims",
            "From": f"sip:{msisdn or to}@{realm}",
            "Body": body.replace("\n", " "),  # AMI 单行 body
        })
        ok = res.get("Response", "").lower().startswith("success")
        return ok, res.get("Message", str(res))

    def originate(self, to: str, endpoint: str = "linphone",
                  callerid: str = "") -> tuple[bool, str]:
        """外呼：先振铃本地 Linphone，接听后桥接到 IMS 呼出。"""
        res = self.action({
            "Action": "Originate",
            "Channel": f"PJSIP/{endpoint}",
            "Exten": to,
            "Context": "from-local",
            "Priority": "1",
            "CallerID": callerid or "simvowifi",
            "Async": "true",
        })
        ok = res.get("Response", "").lower().startswith("success")
        return ok, res.get("Message", str(res))
