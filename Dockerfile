# build front-end
FROM node:18-alpine AS frontend

RUN npm install pnpm -g

# 安装构建工具和 SQLite 依赖
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite-dev
    
WORKDIR /app

COPY ./package.json /app

COPY ./pnpm-lock.yaml /app

RUN pnpm install

COPY . /app

RUN pnpm run build

# build backend
FROM node:18-alpine as backend

RUN npm install pnpm -g

WORKDIR /app

COPY /service/package.json /app

COPY /service/pnpm-lock.yaml /app

RUN pnpm install

COPY /service /app

RUN pnpm build

# service
FROM node:18-alpine

RUN npm install pnpm -g

# 添加必要的构建依赖
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite-dev

WORKDIR /app

COPY /service/package.json /app
COPY /service/pnpm-lock.yaml /app

# 安装依赖并重新构建 sqlite3
RUN pnpm install --production && \
    cd node_modules/sqlite3 && \
    pnpm rebuild && \
    cd ../.. && \
    rm -rf /root/.npm /root/.pnpm-store /usr/local/share/.cache /tmp/*

COPY /service /app

COPY --from=frontend /app/replace-title.sh /app

RUN chmod +x /app/replace-title.sh

COPY --from=frontend /app/dist /app/public

COPY --from=backend /app/build /app/build

COPY --from=backend /app/src/utils/templates /app/build/templates

EXPOSE 3002

CMD ["sh", "-c", "./replace-title.sh && pnpm run prod"]