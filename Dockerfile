# 多阶段构建 - 前端
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# 复制package文件
COPY package*.json ./

# 配置npm使用淘宝镜像
RUN npm config set registry https://registry.npmmirror.com

# 安装所有依赖（包括devDependencies用于构建）
RUN npm install

# 复制源代码
COPY . .

# 构建期只注入可公开的前端配置。
# AI Key 属于服务端机密，绝不能作为 ARG 传进来：Vite 会把构建期变量内联进 JS，
# 而这个镜像的产物由公网 nginx 直接下发。
ARG VITE_API_URL="http://localhost:3225/api"
ARG VITE_BASE_PATH="/"
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_BASE_PATH=$VITE_BASE_PATH

# 构建生产版本
RUN npm run build

# 生产阶段 - Nginx服务器
FROM nginx:alpine

# 安装 wget 用于健康检查
RUN apk add --no-cache wget

# 复制nginx配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 从构建阶段复制构建产物
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# 暴露端口
EXPOSE 80

# 启动nginx
CMD ["nginx", "-g", "daemon off;"]