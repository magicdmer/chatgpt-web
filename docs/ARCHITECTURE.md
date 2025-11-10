# ChatGPT Web 工程架构说明

本文件梳理当前仓库的整体架构、关键模块、数据与请求流转、配置与部署方式，以及扩展改造的建议与注意事项，便于后续进行变更与二次开发。

## 总览

- 前端：`Vue 3 + Vite + TypeScript + Naive UI + Pinia + Vue Router + i18n`
- 后端：`Node.js (Express + TypeScript)`，内置鉴权、限流与审计，基于 `sqlite3` 持久化
- 接口路由：后端同时挂载在根路径 `''` 与 `/api`，前端开发环境通过 Vite 代理 `'/api' -> 后端`
- 构建与部署：支持 Docker 镜像多阶段构建、Docker Compose、Kubernetes 部署
- 配置：`.env`（前端）、`service/.env.example`（后端示例）；后端支持大量环境变量，前端通过 `VITE_*` 变量配置
- 工具：使用`fnm`来管理nodejs环境，该工程使用node18.x

## 目录结构（关键部分）

```
根目录
├─ src/                 # 前端源代码
│  ├─ main.ts           # 应用启动入口（注册资源、i18n、Pinia、路由）
│  ├─ App.vue           # 根组件（Naive UI ConfigProvider 包裹 RouterView）
│  ├─ api/              # 前端接口封装（与后端 REST 对应）
│  ├─ router/           # 路由与权限守卫（hash 模式）
│  ├─ store/            # Pinia 状态（chat、auth、setting 等模块）
│  ├─ views/chat/       # 聊天主界面与布局（Layout、Sider、Header、消息列表等）
│  ├─ utils/request/    # Axios 包装与拦截器（读取 `VITE_GLOB_API_URL`）
│  ├─ locales/          # 多语言文案
│  └─ components/       # 通用组件与设置面板
│
├─ service/             # 后端服务代码
│  ├─ src/index.ts      # Express 路由与业务入口（挂载全部 REST API）
│  ├─ src/middleware/   # 鉴权、限流等中间件（`auth`, `rootAuth`, `limiter`）
│  ├─ src/chatgpt/      # ChatGPT 调用逻辑（代理、敏感词、会话上下文等）
│  ├─ src/storage/      # sqlite 持久化与配置缓存（建表、CRUD、Config/Key 管理）
│  ├─ src/utils/        # 工具（邮件、审核、token 计算等）
│  └─ .env.example      # 后端环境变量示例
│
├─ Dockerfile           # 多阶段构建（前端+后端），最终镜像运行 `pnpm run prod`
├─ docker-compose/      # Compose 示例与 nginx 配置
├─ kubernetes/          # K8S 部署示例
├─ vite.config.ts       # 前端开发代理与 PWA 配置
├─ package.json         # 前端脚本与依赖
└─ README*.md           # 使用说明（中/英）
```

## 前端架构

- 启动流程：
  - `src/main.ts` 创建 `App`，依次执行 `setupAssets`、`setupScrollbarStyle`、`setupStore(app)`、`setupI18n(app)`、`await setupRouter(app)`，最后 `mount('#app')`。
- 路由：
  - `src/router/index.ts` 使用 `createWebHashHistory`，根路由 `ChatLayout`，子路由 `/chat/:uuid?`，异常页路由 `/404`、`/500`。
  - `src/router/permission.ts` 在 `beforeEach` 中拉取会话，处理 `token` 与用户信息，异常时重定向到 `500`。
- 状态管理（Pinia）：
  - `src/store/index.ts` 注册 `Pinia`；`src/store/modules/` 包含 `chat`, `auth`, `setting` 等模块。
  - 典型如 `chat` 模块：维护房间列表与消息历史、上下文开关、模型选择，并调用 `api/`。
- 接口调用：
  - `src/utils/request/axios.ts` 设置 `baseURL = import.meta.env.VITE_GLOB_API_URL`，请求拦截自动附加 `Authorization`；响应拦截对非 `200` 抛错。
  - `src/api/index.ts` 统一封装 REST 方法（房间 CRUD、聊天流程、用户与配置管理、审计与邮件等）。
  - 流式响应与思考：聊天接口以服务端流方式返回增量内容，并在 `options.thinking`/`thinking` 字段回传“思考”片段；房间级开关通过 `/room-thinking` 路由控制。
- UI 框架与布局：
  - 使用 `naive-ui`，根组件 `App.vue` 通过 `NConfigProvider` 注入主题与语言；聊天页面由 `views/chat/layout` 布局（`Sider` + 内容区），移动端自适应。
- i18n：
  - `src/locales/*` 提供多语言文案，设置面板、统计、权限等文案较为完整。
- 开发代理：
  - `vite.config.ts` 在开发模式下将 `'/api'` 代理到 `viteEnv.VITE_APP_API_BASE_URL` 并重写为根路径（后端同时在 `''` 与 `/api` 挂载）。

### 前端与后端的接口映射（示例）

- 聊天流程：
  - `POST /chat-process`（开始或继续对话，支持 `systemMessage`、`temperature`、`top_p`）
  - `POST /chat-abort`（中止响应）
  - `GET /chat-response-history`（按索引回溯历史响应）
  - `GET /chat-history?roomId=...&lastId=...`（分页拉取聊天记录）
- 房间管理：`/room-create`、`/room-rename`、`/room-prompt`、`/room-context`、`/room-chatmodel`、`/room-delete`、`/chatrooms`
  - 思考开关：`/room-thinking`（开启/关闭当前房间的“思考”内容回传）
- 用户与会话：`/session`、`/user-login`、`/user-register`、`/user-info`、`/users`、`/user-status`、`/user-edit`、`/verify`、`/verifyadmin`
- 配置与运维：`/setting-base`、`/setting-site`、`/setting-mail`、`/mail-test`、`/setting-audit`、`/audit-test`、`/setting-keys`、`/setting-key-status`、`/setting-key-upsert`、`/statistics/by-day`

> 注意：部分接口需要 `root` 管理员权限（见后端 `rootAuth` 中间件）。

会话返回约定（/session）：
- `chatModels`：基于管理员在各密钥上勾选的允许模型的并集生成，显示为纯模型名（不再追加“出现次数”的后缀）。
- `allChatModels`：来自各密钥已持久化的“可用模型”并集；若并集为空，则回退为静态内置列表。
- 方法为 `POST /session`，未实现 `GET /session`。

### 密钥管理与模型缓存（Keys.vue 行为说明）

- 模型来源与初始化：
  - 内置模型列表来自 `authStore.session.allChatModels`，用于首次编辑或缓存缺失时的回退。
  - 打开“编辑密钥”弹窗时，优先从本地缓存读取该密钥的模型列表；未命中再回退到内置列表。
- 刷新与缓存写入：
  - 通过 `fetchOpenAIModels({ key, apiBaseUrl })` 拉取模型，成功后覆盖下拉选项并过滤现有选中值，仅保留仍存在于新列表的模型。
  - 刷新后将模型列表写入缓存，命名空间键为 `"<normalizedBaseUrl>__<apiKey>"`：
    - 规范化规则：去掉首尾空格，并移除 `baseUrl` 末尾斜杠（避免 `.../v1` 与 `.../v1/` 不一致）。
    - 当 `baseUrl` 为空时使用占位符 `__default_base__`。
- 缓存读取与兼容：
  - 读取时按上述命名空间键获取；若未命中，同时存在旧版本的全局数组缓存，则回退到 `__legacy__`。
  - 缓存存储采用 `ss`（本地 `localStorage`，`expire: null`），键名为 `modelsStorage`。
- 交互与体验：
  - 刷新按钮在拉取期间显示纯 CSS 旋转圆环，并保证最短显示时长 `400ms`，避免闪烁；按钮在加载时居中显示动画。
- 注意事项：
  - 不同的 `API Key` 与 `Base URL` 组合拥有各自独立的缓存；统一的 `baseUrl` 规范化可避免因尾斜杠或空格导致的缓存未命中。
  - 如需更细粒度的命名空间策略（例如仅按域名或包含路径查询），可在 `buildModelsNamespace` 中扩展规范化逻辑。

## 后端架构

- 应用入口：
  - `service/src/index.ts` 初始化 `express`，注册静态目录 `public`，全局 `JSON` 解析与 CORS 头，构建主路由 `router` 并挂载到 `''` 与 `/api`（便于代理与直连）。
- 中间件：
  - `auth`：基于 `JWT` 与数据库用户状态校验，`AUTH_SECRET_KEY` 存在时强制认证，否则给予“伪 userId”以便无登录使用。
  - `rootAuth`：仅管理员可访问的配置/运维接口；验证 `roles` 包含 `Admin`。
  - `limiter`、`authLimiter`：限流防刷。
- ChatGPT 调用：
  - `service/src/chatgpt/index.ts` 使用官方 `openai` SDK，支持 `SocksProxyAgent`/`HttpsProxyAgent` 与自定义 `baseURL`；
  - 图片生成通过自建 `new-api` 中转服务，返回 `url` 并在前端展示；
  - 流式输出：对话以流式推送增量 `content`，并在检测到“思考”内容时增量回传 `thinking` 片段（Gemini Thinking 等模型受控于房间级开关）；
  - 维护 `conversationId`/`parentMessageId` 上下文，通过 `sqlite` 记录消息与 `usage`（`thinking` 内容保存在 `chat.options` 中）；
- 支持第三方文本审核（默认 `baidu`），可配置请求/响应审核维度。
  - 密钥选择：对每次聊天请求，先按当前用户角色、密钥状态（非 `Disabled`）与房间/聊天选择的模型过滤可用密钥集合，然后在集合中随机选择一个未锁定的密钥；同一密钥使用后会短暂锁定（约 20 秒），若全部锁定会等待最多约 3 秒后重试。
- 存储层：
  - `service/src/storage/sqlite.ts` 使用 `sqlite3`，启动时建表：`chat`、`chat_room`、`user`、`config`、`chat_usage`、`key_config`；数据库文件位于 `./data/chatgpt.db`。
  - 业务方法覆盖：房间与聊天 CRUD、用户管理与统计、配置与 API Key 管理等。
  - 字段补充：`chat_room` 增加 `usingThinking`（房间级“思考”开关）；`chat` 的“思考”内容以 JSON 形式存于 `options.thinking`。
- 配置缓存：
  - `service/src/storage/config.ts` 负责从 DB 或环境变量生成 `Config`，并维护内存缓存与过期；同时提供 `getApiKeys()` 与 Key 的筛选逻辑（角色/模型）。

### 路由与职责（节选）

- 聊天相关：`/chat-process`、`/chat-abort`、`/chat-history`、`/chat-response-history`、`/chat-clear`、`/chat-clear-all`、`/chat-delete`
- 房间相关：`/room-create`、`/room-rename`、`/room-prompt`、`/room-context`、`/room-chatmodel`、`/room-delete`、`/chatrooms`
- 用户/权限：`/session`、`/user-login`、`/user-register`、`/user-info`、`/users`、`/user-status`、`/user-edit`、`/verify`、`/verifyadmin`
- 运维/配置：`/config`（root）、`/setting-base`、`/setting-site`、`/setting-mail`、`/mail-test`、`/setting-audit`、`/audit-test`、`/setting-keys`、`/setting-key-status`、`/setting-key-upsert`、`/statistics/by-day`

## 环境变量与配置

- 前端：
  - `VITE_GLOB_API_URL`：Axios 基础地址（生产/预览）。
  - `VITE_APP_API_BASE_URL`：开发代理目标（`vite.config.ts`），以 `'/api'` 为前缀走代理。
  - `VITE_GLOB_APP_PWA`：是否启用 PWA（`vite-plugin-pwa`）。
- 后端（示例，详见 `service/.env.example` 与 README）：
  - `API Key`：在后台“密钥管理”页面配置，不再使用 `ACCESS_TOKEN`。
  - `OPENAI_API_BASE_URL`：自定义 OpenAI API 地址或 `new-api` 中转地址（与 `API Key` 搭配）。
  - `AUTH_SECRET_KEY`：启用登录与 JWT 加密的盐，开启后端鉴权。
  - `TIMEOUT_MS`、`MAX_REQUEST_PER_HOUR`：超时与限流相关。
  - `SOCKS_PROXY_*` / `HTTPS_PROXY`：网络代理。
  - `SITE_TITLE`、`REGISTER_ENABLED`、`REGISTER_REVIEW`、`REGISTER_MAILS`、`SITE_DOMAIN`：站点/注册配置。
  - `SMTP_*`：邮件服务配置；`AUDIT_*`：文本审核配置。

## 构建与部署

- Docker 多阶段：
  - 第一阶段构建前端（安装依赖、`pnpm build`），第二阶段构建后端（`pnpm build`），最终镜像安装生产依赖并复制 `dist` 到 `/app/public` 与后端 `build`。
  - 运行命令：`./replace-title.sh && pnpm run prod`，端口 `3002`。
- Docker Compose：
  - 默认映射 `3002:3002`，挂载 `./data:/app/data` 持久化 sqlite DB；通过 `environment` 传递后端环境变量。
- Kubernetes：
  - `kubernetes/deploy.yaml` 提供 `Deployment` 与 `Service` 示例，端口 `3002`。

## 数据与请求流转（简述）

1. 前端 `api/index.ts` 发起请求（附带 `Authorization`），`axios` 按 `VITE_GLOB_API_URL` 或开发代理转发。
2. 后端 `index.ts` 通过 `auth/rootAuth/limiter` 等中间件校验后进入路由处理。
3. 聊天请求进入 `chatgpt` 模块，按配置与上下文与代理设置调用 ChatGPT；响应边接收边推送（支持进度事件），并写入 `sqlite`（消息与使用量）。
   同时，对于支持“思考”输出的模型，增量回传 `thinking` 片段并最终在 `options.thinking` 中保留完整内容。
4. 前端 `store` 更新 UI 状态；`views/chat` 以消息列表渲染输出，支持回溯与中止。

## 扩展与改造建议

- 新增后端接口：在 `service/src/index.ts` 新增路由与校验逻辑；若涉及持久化，在 `storage/sqlite.ts` 扩展 CRUD；更新 `api/index.ts` 同步封装并在 `store` 调用。
- 引入新模型或代理：扩展 `storage/model.ts` 的 `chatModelOptions` 与 `KeyConfig`；在 `chatgpt/index.ts` 增加代理适配逻辑与 `setupProxy` 分支。
- 增加管理能力：利用 `rootAuth` 路由，扩展 `setting-*` 与 `statistics-*` 接口；前端在设置面板增加对应项与 i18n 文案。
- 统一开发与生产的接口地址：确保 `VITE_GLOB_API_URL` 与开发代理 `VITE_APP_API_BASE_URL` 指向一致的后端；生产环境建议直接使用 `VITE_GLOB_API_URL`。

## 注意事项与坑位

- 认证开关：`AUTH_SECRET_KEY` 不为空即启用登录；前后端需正确处理 `token`，管理员能力取决于 `roles`。
- 双入口挂载：后端既挂载在 `''` 又挂载在 `/api`，本地开发通过代理；线上可直接使用根路径以避免重复前缀。
- sqlite 依赖：容器内需预装 `python3/make/g++/sqlite-dev`，Dockerfile 已处理；自行部署需确保这些依赖可用。
- 使用统计字段：`usage` 同步在响应 `options` 内，前端需兼容无 `usage` 情况。

---

如需对某模块进行改造，请在 PR/变更说明中同步更新本文件对应章节，保持架构文档与实现一致。