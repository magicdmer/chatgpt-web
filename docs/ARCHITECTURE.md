# ChatGPT Web 工程架构说明

本文档描述当前仓库的运行架构、核心请求链路、关键定制和部署方式，供功能开发、问题排查与后续维护使用。文档以当前实现为准；修改关键行为时，应同步更新对应章节。

## 1. 架构概览

- 前端：`Vue 3 + Vite + TypeScript + Naive UI + Pinia + Vue Router + vue-i18n`
- 后端：`Node.js + Express + TypeScript`
- 数据存储：服务端使用 `sqlite3`；前端聊天缓存使用 `IndexedDB`（`localforage`）
- 模型接入：通过 OpenAI 兼容接口连接不同模型服务，可配置自定义 `baseURL`，通常由 `new-api` 等中转服务统一接入
- 主要能力：多会话聊天、上下文续聊、流式响应、思考内容、图片上传与图文对话、图片生成、用户和密钥管理、限流、审核及使用量统计
- 部署方式：支持 Docker、Docker Compose 和 Kubernetes，默认服务端口为 `3002`
- 运行环境：项目以 Node.js 18 为主要构建和运行环境，可使用 `fnm` 管理 Node.js 版本

后端路由同时挂载在根路径和 `/api`。开发环境由 Vite 将 `/api` 与 `/uploads` 代理到后端；生产环境通常由同一个 Express 服务同时提供前端静态文件和 API。

## 2. 目录结构

```text
根目录
├─ src/
│  ├─ api/                    # REST API 封装
│  ├─ components/             # 通用组件和设置面板
│  ├─ locales/                # 国际化文案
│  ├─ router/                 # 路由与权限守卫
│  ├─ store/                  # Pinia 状态与前端持久化
│  ├─ utils/                  # 请求、模型和通用工具
│  ├─ views/chat/             # 聊天页面、消息列表和侧边栏
│  ├─ App.vue                 # 根组件
│  └─ main.ts                 # 前端启动入口
├─ service/
│  ├─ src/chatgpt/            # 模型调用、流式处理和上下文组装
│  ├─ src/plugins/            # 插件扫描、启用校验、工具执行与宿主服务
│  ├─ src/middleware/         # 鉴权与限流中间件
│  ├─ src/storage/            # SQLite、配置和密钥管理
│  ├─ src/utils/              # 邮件、审核和 Token 等工具
│  ├─ plugin-sdk/             # 插件 BasePlugin、@llmTool 与类型定义
│  ├─ src/index.ts            # Express 入口与 REST 路由
│  └─ .env.example            # 后端环境变量示例
├─ plugins/                   # 外置插件；每个子目录包含 plugin.json 和 TS 入口
├─ docker-compose/            # Compose 与 Nginx 示例
├─ kubernetes/                # Kubernetes 部署示例
├─ Dockerfile                 # 前后端多阶段构建
├─ vite.config.ts             # Vite、PWA 与开发代理配置
└─ package.json               # 前端依赖和脚本
```

主要运行时数据：

- `data/chatgpt.db`：SQLite 数据库；容器部署时映射到 `/app/data`
- `service/uploads/`：本地开发上传目录；容器部署时使用 `/app/uploads`
- `chatStorage`：浏览器 IndexedDB 中的聊天缓存

## 3. 前端架构

### 3.1 启动、路由与状态

- `src/main.ts` 初始化资源、Pinia、i18n 和路由，并在挂载应用前调用 `useChatStore().initStore()` 恢复聊天缓存。
- `src/router/index.ts` 使用 Hash 路由。聊天页面位于 `/chat/:uuid?`，并提供 `/404`、`/500` 异常页。
- `src/router/permission.ts` 在路由进入前加载会话信息，处理 Token、用户状态和异常跳转。
- `src/store/modules/chat/` 管理房间、消息、当前模型、上下文开关、思考开关和生成状态。

聊天数据使用 `localforage` 写入 IndexedDB，避免较长对话或大体积图片内容超出 `localStorage` 容量。写入前会转为普通 JSON 对象，避免 Vue Proxy 导致结构化克隆失败。

### 3.2 请求与界面

- `src/api/index.ts` 集中封装聊天、房间、用户、密钥、配置和统计接口。
- `src/utils/request/axios.ts` 读取 `VITE_GLOB_API_URL` 作为基础地址，并自动附加 `Authorization` 请求头。
- `src/views/chat/index.vue` 负责消息提交、流式增量更新、图片附件、重新生成、中止请求和历史图片回填。
- 页面使用 Naive UI，聊天布局由侧边栏、顶部区域、消息列表和输入区组成，并适配移动端。
- 传统用户/助手头像和部分冗余操作入口已移除，界面采用 Indigo-Violet 视觉风格。

## 4. 后端架构

### 4.1 服务入口与中间件

`service/src/index.ts` 创建 Express 应用，注册 JSON 解析、CORS、静态文件、上传目录和业务路由。主要中间件包括：

- `auth`：当 `AUTH_SECRET_KEY` 有值时校验 JWT 和用户状态；未启用登录时提供匿名使用所需的内部用户标识
- `rootAuth`：限制管理员配置、用户管理和统计接口
- `limiter`、`authLimiter`：限制普通请求与认证请求频率

### 4.2 模型调用与上下文

- `service/src/chatgpt/index.ts` 使用 OpenAI SDK，并支持自定义 `baseURL`、HTTPS 代理和 SOCKS 代理。
- 后端根据用户角色、密钥状态和所选模型筛选可用密钥，再从未锁定的候选密钥中选择一个执行请求。
- 会话通过 `conversationId` 和 `parentMessageId` 形成消息链；启用上下文时，后端最多向前回溯 20 条关联消息组装请求。
- 普通回复以流式增量返回；模型提供独立思考内容时，同时返回 `thinking`，最终写入消息的 `options`。
- 模型未返回 Token Usage 时，服务端会按模型映射进行估算，并统一持久化 `prompt_tokens`、`completion_tokens` 和 `total_tokens`。

### 4.3 存储与上传

- `service/src/storage/sqlite.ts` 管理 `chat`、`chat_room`、`user`、`config`、`chat_usage` 和 `key_config` 等表。
- `service/src/storage/config.ts` 合并数据库配置与环境变量，并维护配置缓存和密钥筛选逻辑。
- 用量统计按服务器本地日期聚合 `chat_usage`。普通用户只能查询本人，管理员可查看全站或指定用户，并获得请求数、Token 汇总、估算占比、用户排行及会话模型分布；单次查询范围最多 366 天。
- 图片上传支持单文件和多文件；上传结果以静态 URL 返回，聊天请求再将其转换为 OpenAI 兼容的 `image_url` 内容。
- 上传清理器由保留时长和清理间隔控制，可通过环境变量关闭。

### 4.4 插件运行时

- 服务启动时扫描 `PLUGIN_DIR`（默认根目录 `plugins/`）下的一级子目录，校验 `plugin.json` 后动态加载 TypeScript 入口。管理员也可在插件页面点击“刷新”手动重新扫描；扫描完成后原子替换内存注册表。
- 插件入口默认导出 `BasePlugin` 子类；使用 `@llmTool` 标记的方法会自动成为 Function Call 工具，一个插件可以提供多个工具。
- `plugin.json.id` 是去掉连字符的 32 位小写 GUID，也是数据库与用户状态的稳定主键；插件名称和工具名称均不设置数据库唯一约束。
- 管理员可以使用未发布插件，也可以将插件发布给普通用户。每个用户独立启用或停用插件；启用时若任一工具名与已启用插件重复，服务端拒绝操作并提示冲突插件。
- 插件设置由 `plugin.json.settings` 描述，只能由管理员统一修改；普通用户的插件页只提供启用和停用操作。密钥类设置不会通过查询接口回传明文。
- 手动绘图与自动 Function Call 共用同一个 `generate_image` 工具。勾选绘图按钮时请求直接执行该工具并返回，不再进入聊天模型调用，因此不会重复生图，也不依赖当前聊天模型。
- `plugin_config` 保存发布状态和全局设置，`user_plugin_config` 保存用户启用状态，`plugin_storage` 为插件提供按全局或用户隔离的 JSON 存储。

## 5. 核心运行链路

### 5.1 聊天请求

1. `src/views/chat/index.vue` 先将用户消息加入当前房间，创建请求控制器，并把房间标记为生成中。
2. `src/api/index.ts` 调用 `/chat-process`；Axios 根据运行环境直连 API 或通过 Vite 代理转发。
3. 后端完成鉴权、限流和房间校验，将用户消息及请求参数写入 SQLite。
4. 后端按 `parentMessageId` 组装历史上下文；请求带有图片时，将当前文本和图片组成多模态用户消息。
5. 模型响应按行增量写回，前端持续更新助手消息、思考内容、工具状态和 Token Usage。
6. 响应结束后，后端保存助手回复及上下文标识；前端解除房间加载状态并持久化本地缓存。

中止请求由 `/chat-abort` 处理；重新生成会复用原用户消息，并保留此前回复供历史版本切换。

### 5.2 后台生成与新建会话

- 切换或离开聊天页面时，已有请求控制器不会因组件卸载而自动中止，因此原房间可以继续接收生成结果。
- 新建会话采用乐观更新：侧边栏立即创建并切换本地房间，`/room-create` 在后台完成持久化，避免接口响应阻塞界面交互。
- 生成状态按房间维护；刷新页面时，只有不存在有效请求控制器的孤立加载状态会被清理。

### 5.3 图片上传与图文对话

1. 用户选择或粘贴图片，前端调用 `/upload-image` 或 `/upload-images`。
2. 后端保存文件并返回可访问 URL，前端在输入区展示附件预览。
3. 用户发送消息时，前端通过 `/chat-process` 的 `images: string[]` 提交文本和图片。
4. 后端将图片转换为模型可读取的 URL 或 Data URL，与文本一起提交，并将附件记录到聊天历史。

> **关键定制：**`src/views/chat/index.vue` 中的图片编辑按钮通过 `showEditButton = false` 默认关闭。当前前端所有带图片的请求均按图文对话处理，统一走 `/chat-process`。后续维护时不要擅自重新开启该按钮。

### 5.4 连续图文对话的自动垫图

仅当房间启用上下文、当前请求没有新附件时，前端才会回填历史图片：

1. 优先向前查找最近一条包含 Markdown 或 HTML 图片的助手回复。找到后，将图片附加到当前请求，并将本次文本上下文重置为 `options={}`，使模型聚焦于图片和当前输入。
2. 如果没有找到助手回复中的图片，则查找最近一条带图片附件的历史请求。找到后附加该图片，同时保留原有文本上下文，以支持围绕同一图片连续追问。
3. 关闭房间上下文或当前请求已上传新图片时，不执行历史图片回填。

这里的判断只决定“回填哪张图片以及是否保留文本历史”，不代表对用户意图进行分类。

## 6. API 职责

| 分类 | 主要接口 | 职责 |
| --- | --- | --- |
| 聊天 | `/chat-process`、`/chat-abort`、`/chat-history`、`/chat-response-history`、`/chat-delete`、`/chat-clear` | 生成、中止、查询和管理消息 |
| 房间 | `/room-create`、`/room-rename`、`/room-prompt`、`/room-context`、`/room-thinking`、`/room-chatmodel`、`/room-delete`、`/chatrooms` | 管理房间及房间级模型和功能开关 |
| 图片 | `/upload-image`、`/upload-images`、`/uploads/*` | 上传图片并提供静态访问 |
| 用户 | `/session`、`/user-login`、`/user-register`、`/user-info`、`/users`、`/user-status`、`/user-edit`、`/verify`、`/verifyadmin` | 会话、认证与用户管理 |
| 配置与运维 | `/config`、`/setting-*`、`/mail-test`、`/audit-test`、`/statistics/by-day` | 站点配置、密钥、邮件、审核与统计 |
| 插件 | `/plugin/list`、`/plugin/refresh`、`/plugin/enabled`、`/plugin/publish`、`/plugin/settings` | 查询可见插件、管理员刷新、用户启停、管理员发布与全局设置 |

部分配置、用户和统计接口受 `rootAuth` 保护。`/session` 使用 `POST`，其模型字段约定如下：

- `chatModels`：管理员在各密钥上允许使用的模型并集
- `allChatModels`：各密钥已持久化的可用模型并集；为空时回退到内置模型列表

## 7. 密钥与模型缓存

管理员在 `Keys.vue` 中刷新模型列表时，前端调用 `fetchOpenAIModels({ key, apiBaseUrl })`，并使用 `modelsStorage` 保存结果：

- 缓存按规范化后的 `Base URL + API Key` 隔离，键格式为 `"<normalizedBaseUrl>__<apiKey>"`
- `baseUrl` 会去除首尾空格和末尾斜杠；空地址使用 `__default_base__`
- 命名空间缓存未命中时，可以从旧版 `__legacy__` 缓存回退
- 刷新成功后会更新候选模型，并移除已选择但已不存在的模型
- 刷新动画至少展示 `400ms`，避免快速请求导致闪烁

不同服务地址或密钥必须保持独立缓存，修改命名空间规则时需要兼顾旧缓存迁移。

## 8. 配置

### 8.1 前端环境变量

- `VITE_GLOB_API_URL`：Axios 基础地址，默认使用 `/api`
- `VITE_APP_API_BASE_URL`：Vite 开发代理目标
- `VITE_GLOB_OPEN_LONG_REPLY`：是否在输出长度受限时自动续写
- `VITE_GLOB_APP_PWA`：是否启用 PWA

### 8.2 后端配置

API Key 和允许使用的模型主要在管理后台的密钥管理页面配置。常用环境变量包括：

- `OPENAI_API_BASE_URL`：默认 OpenAI 兼容接口地址或中转地址
- `AUTH_SECRET_KEY`：登录和 JWT 密钥；非空时启用鉴权
- `TIMEOUT_MS`、`MAX_REQUEST_PER_HOUR`：模型请求超时与限流
- `SOCKS_PROXY_*`、`HTTPS_PROXY`：网络代理
- `SITE_TITLE`、`REGISTER_ENABLED` 等：站点和注册策略
- `SMTP_*`、`AUDIT_*`：邮件和文本审核
- `UPLOAD_MAX_SIZE_MB`、`UPLOAD_CLEAN_INTERVAL`、`UPLOAD_SAVE_HOURS`：上传限制与清理策略
- `PLUGIN_DIR`：外置插件根目录，容器内默认使用 `/app/plugins`

完整配置及默认值以 `service/.env.example` 和管理后台为准。

## 9. 构建与部署

- 本地开发：根目录运行前端，`service/` 运行后端；前端通过 Vite 代理访问后端。
- 前端构建：`pnpm build`，包含 `vue-tsc --noEmit` 和 Vite 构建。
- 后端构建：在 `service/` 运行 `pnpm build`，由 `tsup` 输出到 `service/build/`。
- Docker：多阶段构建前端与后端，最终镜像在 `/app/public` 提供前端资源，通过 `./replace-title.sh && pnpm run prod` 启动，监听 `3002`。
- Docker Compose：默认映射 `3002:3002`，持久化 `/app/data` 与 `/app/uploads`，并将宿主机 `plugins/` 只读挂载到 `/app/plugins`；可选 Nginx 反向代理。
- Kubernetes：`kubernetes/deploy.yaml` 提供 Deployment 和 Service 示例。

SQLite 原生依赖需要 `python3`、`make`、`g++` 和 SQLite 开发库；Dockerfile 已安装并重新构建 `sqlite3`。

## 10. 扩展与维护约束

- 新增接口时，同步修改 `service/src/index.ts`、`src/api/index.ts`；涉及数据结构时同步修改 `service/src/storage/`。
- 新增模型或代理能力时，检查密钥筛选、模型列表、请求参数和 Token 估算映射。
- 新增房间级设置时，同时处理数据库字段、会话返回值、Pinia 状态、前端控件和国际化文案。
- 开发和生产环境应分别核对 `VITE_APP_API_BASE_URL` 与 `VITE_GLOB_API_URL`，避免重复 `/api` 前缀。
- `AUTH_SECRET_KEY` 非空即启用登录；管理员权限取决于用户角色是否包含 `Admin`。
- 后端同时挂载根路径和 `/api`，部署反向代理时只能选择一种入口拼接方式。
- 响应可能不包含模型原生 Usage，前端和统计逻辑必须兼容估算值或缺失值。
- 提交影响架构、请求链路或关键定制的变更时，应同步更新本文档。
- 插件工具的参数 Schema 和执行入口必须同时存在；不要向模型暴露无法执行的临时工具声明。
- 插件发布、设置和启用状态必须通过插件 ID 关联，不得用可变的插件名称作为主键。
