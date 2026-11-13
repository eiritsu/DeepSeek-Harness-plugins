# Kali Isolated Sandbox / 隔离沙箱环境

DeepSeek Harness 红队攻防演练的轻量化容器沙箱，用于完全隔离所有扫描发包与工具执行，避免污染日常办公宿主机并防止宿主机杀软 (EDR) 误拦截。

---

## ⚡ 极速启动（无需本地编译 Dockerfile）

只需在终端运行一条命令，拉取官方 Kali Linux 镜像即可开箱即用：

```bash
docker run -d --name dsh-kali-sandbox --restart unless-stopped \
  -v ~/.dsh/redteam:/root/.dsh/redteam \
  -w /root/.dsh/redteam \
  kalilinux/kali-rolling sleep infinity
```

---

## 🛠️ 自定义构建完整工具镜像（可选）

使用本目录下的 `Dockerfile` 或 `docker-compose.yml` 构建包含全套 15+ 核心工具的定制沙箱：

```bash
docker compose up -d
```

或使用原生 Docker 命令：

```bash
docker build -t dsh-kali-sandbox:latest .
docker run -d --name dsh-kali-sandbox --restart unless-stopped \
  -v ~/.dsh/redteam:/root/.dsh/redteam \
  -w /root/.dsh/redteam \
  dsh-kali-sandbox:latest
```

---

## 🧹 演练结束一键销毁

演练结束后，只需执行以下命令即可彻底销毁容器，宿主机干干净净零残留：

```bash
docker rm -f dsh-kali-sandbox
```
