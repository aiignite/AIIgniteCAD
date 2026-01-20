FROM node:20-alpine

WORKDIR /app

# 安装系统依赖
RUN apk add --no-cache openssl3

# 配置npm使用淘宝镜像
RUN npm config set registry https://registry.npmmirror.com

# 复制package文件
COPY package*.json ./
COPY prisma ./prisma/

# 安装依赖
RUN npm install

# 复制源代码
COPY . .

# 生成Prisma客户端
RUN npx prisma generate

# 构建TypeScript
RUN npx tsc

# 暴露端口
EXPOSE 3410

# 启动脚本
CMD ["npm", "start"]