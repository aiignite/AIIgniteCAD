# syntax=docker/dockerfile:1
#
# LibreDWG 只提供源码包，Debian/Alpine 仓库都没有现成二进制；
# 因此在一个临时构建阶段编译 dwg2dxf，再把二进制与共享库复制到 Node 运行时。
FROM debian:bookworm-slim AS build

ARG LIBREDWG_VERSION=0.14
# GNU 主站与阿里云镜像的 0.14 源码包内容一致；固定哈希，回退镜像时也能校验来源
ARG LIBREDWG_SHA256=cb6ee0b078c6d9e0f09d66f1feac33ba6342df88ae544e9f9335fab475218351

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        build-essential \
        autoconf \
        automake \
        libtool \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

# 共享生产机在国内且只有 4 GB 内存：主站下载可能长时间无响应，带超时后回退镜像；
# make 并发固定为 2，避免 nproc 读到宿主机核数后把内存打爆
RUN set -eux; \
    version="${LIBREDWG_VERSION}"; \
    curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 15 \
        --speed-limit 1024 --speed-time 30 --max-time 300 \
        "https://ftp.gnu.org/gnu/libredwg/libredwg-${version}.tar.gz" \
        -o /tmp/libredwg.tar.gz \
    || curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 \
        "https://mirrors.aliyun.com/gnu/libredwg/libredwg-${version}.tar.gz" \
        -o /tmp/libredwg.tar.gz; \
    echo "${LIBREDWG_SHA256}  /tmp/libredwg.tar.gz" | sha256sum -c -; \
    mkdir -p /tmp/libredwg; \
    tar -xzf /tmp/libredwg.tar.gz -C /tmp/libredwg --strip-components=1; \
    cd /tmp/libredwg; \
    ./configure --prefix=/opt/libredwg --disable-bindings --disable-python; \
    make -j2; \
    make install

FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PORT=3310 \
    PATH="/opt/libredwg/bin:${PATH}" \
    LD_LIBRARY_PATH="/opt/libredwg/lib"

WORKDIR /app

COPY --from=build /opt/libredwg /opt/libredwg
COPY server.cjs ./

USER node

EXPOSE 3310

CMD ["node", "server.cjs"]
