# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.18.0
ARG PNPM_VERSION=9.15.9

FROM node:${NODE_VERSION}-alpine AS base

ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# Build the frontend.
FROM base AS frontend

COPY package.json pnpm-lock.yaml ./
COPY service/plugin-sdk ./service/plugin-sdk

RUN --mount=type=cache,id=pnpm-frontend,target=/pnpm/store \
	pnpm install --frozen-lockfile

COPY .env index.html postcss.config.js tailwind.config.js tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src

RUN pnpm build

# Build the backend without running native dependency install scripts.
FROM base AS backend

COPY service/package.json service/pnpm-lock.yaml ./
COPY service/plugin-sdk ./plugin-sdk

RUN --mount=type=cache,id=pnpm-backend,target=/pnpm/store \
	pnpm install --frozen-lockfile --ignore-scripts

COPY service/src ./src
COPY service/tsconfig.json service/tsup.config.ts ./

RUN pnpm build && cp -R src/utils/templates build/templates

# Build production dependencies, including sqlite3 for the target architecture.
FROM base AS production-dependencies

COPY service/package.json service/pnpm-lock.yaml ./
COPY service/plugin-sdk ./plugin-sdk

RUN --mount=type=cache,id=pnpm-production,target=/pnpm/store \
	apk add --no-cache --virtual .build-deps python3 make g++ \
	&& npm install node-gyp@11.5.0 -g \
	&& pnpm install --frozen-lockfile --prod --ignore-scripts \
	&& node-gyp rebuild --directory node_modules/sqlite3 --nodedir=/usr/local \
	&& npm uninstall node-gyp -g \
	&& apk del .build-deps \
	&& rm -rf /root/.npm /root/.pnpm-store /usr/local/share/.cache /tmp/*

# Keep only runtime files in the final image. TypeScript plugins require the tsx loader.
FROM node:${NODE_VERSION}-alpine AS runtime

WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/plugin-sdk ./plugin-sdk
COPY --from=frontend /app/dist ./public
COPY --from=backend /app/build ./build
COPY plugins ./plugins
COPY replace-title.sh ./replace-title.sh

RUN chmod +x ./replace-title.sh \
	&& mkdir -p ./data ./uploads

EXPOSE 3002

CMD ["sh", "-c", "./replace-title.sh && exec node --import tsx ./build/index.js"]
