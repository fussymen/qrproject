# 卡票二维码网页服务 · 部署指南

> 目标：把 `qrcode-app/` 部署到一台可公网访问的服务器（或云平台），
> 这样你**在任何地方、任何设备、用浏览器打开一个网址就能看到卡票二维码**。
>
> ⚠️ 重要前提：**微信小程序本身不能"放到服务器上随处打开"**——它只能在微信 App 内运行。
> 能部署的是这里的 **H5 网页版（Node 后端 + 前端页面）**，它本来就是为"浏览器随处访问"设计的。

---

## 它现在能干什么（已验证）

- 后端 `server.js` 是**纯 Node、零第三方依赖**（只用内置 http/https/crypto），部署极简。
- 已内置你的 token（`auth.json`），部署后**打开网页即出码**，无需再登录。
- 后端替前端完成：API 签名、跨域代理、token 持久化、WebSocket 实时刷新代理。
- token 有效期约 100 天（实测到 2026-10-15）。过期后，网页会提示重新填 token——
  在网页里贴入新的 `x-token` + `uid` 即可（抓取方法同小程序）。

---

## 方式一：Docker（最通用，推荐）

适合任何装了 Docker 的服务器 / 云主机 / 云平台。

```bash
# 1) 把 qrcode-app/ 整个目录传到服务器
scp -r qrcode-app/ user@你的服务器:/opt/card-qrcode/

# 2) 构建镜像
ssh user@你的服务器
cd /opt/card-qrcode
docker build -t card-qrcode .

# 3) 运行（挂载 /data 持久化 token 刷新结果）
docker run -d --name card-qrcode \
  -p 3000:3000 \
  -v /opt/card-qrcode/data:/data \
  --restart unless-stopped \
  card-qrcode

# 4) 验证
curl http://127.0.0.1:3000/api/status
```

浏览器访问 `http://服务器IP:3000` 即可。要域名 + HTTPS，见下方「加 HTTPS」。

---

## 方式二：直接 Node + PM2（无 Docker 的 VPS）

```bash
# 服务器需先装 Node.js（>=14）
cd /opt/card-qrcode
npm install -g pm2            # 进程守护
pm2 start server.js --name card-qrcode
pm2 save
pm2 startup                   # 开机自启（按提示执行生成的命令）

# 自定义端口（可选）
PORT=8080 pm2 restart card-qrcode --update-env
```

---

## 方式三：免费云平台（没有自己的服务器也能用）— 最省事

> ⚠️ Koyeb 已转为收费，不再推荐。下面列出的都是**仍可长期免费**的方案。
> 说明：绝大多数免费 Node 平台都需要先有一个 GitHub 仓库（一次性，2 分钟），
> 只有 Glitch / Cloudflare Tunnel 可以完全不碰 Git。

### 3.1 Render 免费版（稳定、长期免费、需 GitHub 仓库）★ 推荐
本目录已附 `render.yaml`，实现"连仓库即部署"：
1. 把 `qrcode-app/` 内容推到你的 GitHub 仓库（没有就花 1 分钟新建一个公开仓库）。
2. 打开 https://render.com → **New** → **Web Service** → 选择该仓库。
3. Render 自动读取 `render.yaml`：运行 `node server.js`、监听 `PORT=3000`、健康检查 `/api/status`。
4. 点 Create → 分配 `xxx.onrender.com` 公网 HTTPS 网址（免费版空闲 15 分钟后会休眠，访问时自动唤醒，约 30s）。
5. 之后每次 push 自动重新部署。

### 3.2 Zeabur（国内可直连、中文界面、有免费额度、需 GitHub）
对国内用户更友好（中文文档、访问快）：
1. 打开 https://zeabur.com ，用 GitHub 登录。
2. 新建 Project → 添加服务时选择「从 GitHub 部署」→ 选你的仓库。
3. Zeabur 自动识别 Node，启动命令 `node server.js`、端口 3000。
4. 部署完分配 `xxx.zeabur.app` 网址（免费额度够个人用）。

### 3.3 Glitch（免信用卡、免 Git、免费，但会休眠）
适合完全不想建仓库的人；应用文件少，可手动建：
1. 打开 https://glitch.com ，注册/登录。
2. **New Project** → **Import from GitHub**（若你愿建仓库）或 **Blank** 空白项目。
3. 在左侧文件树里新建并粘贴这几个文件：`package.json`、`server.js`、`index.html`、`qrcode.min.js`、`auth.json`（内容即本目录对应文件）。
4. Glitch 会自动 `npm start` 运行 `node server.js`，分配 `xxx.glitch.me` 公网网址。
> 免费版项目 5 分钟无访问会休眠，打开时自动唤醒。

### 3.4 Cloudflare Tunnel（瞬时免费、无需注册/无需服务器，但需本机常开）
如果你只是想"现在立刻有个公网网址、且电脑一直开着"：
1. 本机先 `node server.js`（默认 3000 端口）。
2. 安装 `cloudflared`，运行：`cloudflared tunnel --url http://localhost:3000`
3. 终端会给出一个 `https://xxx.trycloudflare.com` 公网网址，手机/别处浏览器直接打开即出码。
> 优点：零注册、零费用、秒开；缺点：本机关机/隧道关闭后网址失效。

### 3.5 腾讯云 CloudBase 云托管（国内、需腾讯云账号）
1. 腾讯云控制台 → 云开发 CloudBase → 新建环境（有免费额度）。
2. 左侧「云托管」→ 新建服务 → 部署方式选「本地代码/代码包」，上传 `qrcode-app/`。
3. 运行命令 `node server.js`，监听端口 3000。
4. 部署后平台给一个默认 HTTPS 访问地址，也可绑定自定义域名。

> 这些方案的免费额度都够个人使用。部署后拿到的网址直接在手机/电脑浏览器打开即可，
> token 已内置（`auth.json`），**打开即出码**。

---

## 加 HTTPS + 域名（让任何地方都能放心打开）

1. 买一个域名，把 `A 记录` 解析到服务器公网 IP。
2. 在服务器上装 Nginx，参考本目录 `nginx.conf.example`：
   - 反向代理到 `127.0.0.1:3000`
   - 已包含 WebSocket 升级头（实时刷新需要）
3. 一键申请免费证书：`sudo certbot --nginx -d 你的域名`
4. 重载：`sudo nginx -t && sudo systemctl reload nginx`

之后访问 `https://你的域名` 即可。

---

## 日常维护

- **token 过期**（约 100 天）：网页会显示登录框 → 在小程序卡票页用内存抓取工具重新提取 `x-token` 和 `uid` → 粘贴进网页即可。后端会自动写回 `auth.json`（Docker 下在挂载的 `/data` 卷里）。
- **换服务器**：直接把 `qrcode-app/` 整个目录带走，`auth.json` 里带着 token，到新机器跑起来即出码。
- **日志**：`pm2 logs card-qrcode` 或 `docker logs card-qrcode`。

---

## 文件清单

| 文件 | 作用 |
|---|---|
| `server.js` | 后端：静态服务 + API 签名代理 + token 持久化 + WS 代理 |
| `index.html` | 前端页面：卡票列表 + 二维码渲染（用本地 `qrcode.min.js`） |
| `qrcode.min.js` | 浏览器端二维码生成库（本地自带，不依赖外网 CDN） |
| `auth.json` | 已捕获的 token（部署即出码） |
| `package.json` | 启动脚本声明 |
| `Dockerfile` | 容器化部署 |
| `render.yaml` | Render 平台一键部署描述 |
| `nginx.conf.example` | 反向代理 + HTTPS 示例 |
| `DEPLOY.md` | 本文件 |
