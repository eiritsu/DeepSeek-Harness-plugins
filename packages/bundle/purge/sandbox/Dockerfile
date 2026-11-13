# =============================================================================
# DeepSeek Harness - Redteam Kali Isolated Sandbox Container
# =============================================================================
# 基于官方 Kali Linux 构建隔离攻防演练沙箱环境。
# 所有的网络发包、漏洞扫描、弱口令爆破与 WebShell 落地均在容器内部隔离执行，
# 宿主机只保留 DSH Web / 桌面客户端交互，确保宿主机零污染与防 EDR 拦截。
# =============================================================================

FROM kalilinux/kali-rolling:latest

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# 1. 基础系统与 Kali 核心攻防工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    wget \
    ca-certificates \
    git \
    jq \
    dnsutils \
    iproute2 \
    iputils-ping \
    procps \
    tmux \
    socat \
    netcat-traditional \
    proxychains4 \
    python3 \
    python3-pip \
    python3-impacket \
    nmap \
    masscan \
    nuclei \
    sqlmap \
    ffuf \
    feroxbuster \
    gobuster \
    hydra \
    john \
    hashcat \
    wpscan \
    nikto \
    whatweb \
    amass \
    subfinder \
    httpx-toolkit \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 创建命令别名兼容
RUN ln -sf /usr/bin/httpx-toolkit /usr/local/bin/httpx || true

# 2. 准备沙箱工作区与工具目录
WORKDIR /root/.dsh/redteam
VOLUME ["/root/.dsh/redteam"]

# 3. 初始化 nuclei 模板缓存（可选更新）
RUN nuclei -update-templates || true

# 容器保持后台运行，供 DSH docker exec 交互执行
CMD ["sleep", "infinity"]
