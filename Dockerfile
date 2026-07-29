# build front-end
FROM node:24-alpine AS frontend

RUN npm install pnpm@9.15.9 -g
    
WORKDIR /app

COPY ./package.json /app

COPY ./pnpm-lock.yaml /app

# package.json references the local plugin SDK for plugin type checking.
COPY ./service/plugin-sdk /app/service/plugin-sdk

RUN pnpm install --frozen-lockfile

COPY . /app

RUN pnpm run build

# build backend
FROM node:24-alpine AS backend

RUN npm install pnpm@9.15.9 -g

WORKDIR /app

COPY /service/package.json /app

COPY /service/pnpm-lock.yaml /app

COPY /service/plugin-sdk /app/plugin-sdk

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY /service /app

RUN pnpm build

# service
FROM node:24-alpine

RUN npm install pnpm@9.15.9 -g

WORKDIR /app

COPY /service/package.json /app
COPY /service/pnpm-lock.yaml /app
COPY /service/plugin-sdk /app/plugin-sdk

# 安装依赖并使用支持 Node 24 的 node-gyp 重新构建 sqlite3
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm install node-gyp@11.5.0 -g && \
    pnpm install --frozen-lockfile --production --ignore-scripts && \
    node-gyp rebuild --directory node_modules/sqlite3 --nodedir=/usr/local && \
    npm uninstall node-gyp -g && \
    apk del .build-deps && \
    rm -rf /root/.npm /root/.pnpm-store /usr/local/share/.cache /tmp/*

COPY /service /app

COPY --from=frontend /app/replace-title.sh /app

RUN chmod +x /app/replace-title.sh

COPY --from=frontend /app/dist /app/public

COPY --from=backend /app/build /app/build

COPY --from=backend /app/src/utils/templates /app/build/templates

COPY /plugins /app/plugins

EXPOSE 3002

CMD ["sh", "-c", "./replace-title.sh && pnpm run prod"]
