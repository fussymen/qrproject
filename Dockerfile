# 卡票二维码网页服务 - 容器镜像
# 纯 Node（零依赖），base 选极小的 alpine 即可
FROM node:18-alpine

WORKDIR /app

# 仅拷贝运行所需文件（auth.json 含已捕获 token，部署即出码）
COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY qrcode.min.js ./
COPY auth.json ./init-auth.json

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
# token 持久化目录：运行时挂载卷到 /data，刷新 token 后不丢
ENV DATA_DIR=/data

# 首次启动若 /data/auth.json 不存在，用内置的 init-auth.json 作为初始 token
RUN mkdir -p /data && cp init-auth.json /data/auth.json

CMD ["node", "server.js"]
