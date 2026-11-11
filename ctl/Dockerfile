# simvowifi WebUI 容器
# 只在 compose 单栈里跑；通过 docker.sock 控制同栈的 engine 容器。
FROM python:3.12-slim

# docker CLI：从官方 CLI 镜像取静态二进制，避免把整个 daemon 装进来
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

# pyscard 需要 pcsc-lite 客户端库和编译期依赖
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential swig libpcsclite-dev libpcsclite1 openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /repo/ctl

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
 && apt-get purge -y build-essential swig libpcsclite-dev \
 && apt-get autoremove -y

COPY . /repo/ctl

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/repo/ctl \
    SIMVOWIFI_DATA=/repo/data

EXPOSE 8081

CMD ["python", "-m", "app.webui", "--host", "0.0.0.0", "--port", "8081"]
