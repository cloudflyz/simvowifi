# simvowifi WebUI 容器
# 只在 compose 单栈里跑；通过 docker.sock 控制同栈的 engine 容器。
FROM python:3.12-slim

# docker CLI：从官方 CLI 镜像取静态二进制，避免把整个 daemon 装进来
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

# pyscard 需要 pcsc-lite 客户端库和编译期依赖
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential swig libpcsclite-dev libpcsclite1 openssl ca-certificates \
      curl unzip \
 && rm -rf /var/lib/apt/lists/*

# lpac（eSIM/eUICC 管理，ES9+/ES10）——官方静态发布包，按构建架构选
ARG LPAC_VERSION=2.3.0
ARG TARGETARCH=amd64
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) LPAC_ARCH=x86_64 ;; \
      arm64) LPAC_ARCH=aarch64 ;; \
      *) echo "unsupported arch: $TARGETARCH"; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/lpac.zip \
      "https://github.com/estkme-group/lpac/releases/download/v${LPAC_VERSION}/lpac-linux-${LPAC_ARCH}.zip"; \
    unzip -o /tmp/lpac.zip -d /usr/local/bin; \
    chmod +x /usr/local/bin/lpac; \
    rm -f /tmp/lpac.zip; \
    lpac version || true

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
