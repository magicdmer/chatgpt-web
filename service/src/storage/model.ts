import type { TextAuditServiceOptions, TextAuditServiceProvider } from 'src/utils/textAudit'

export enum Status {
  Normal = 0,
  Deleted = 1,
  InversionDeleted = 2,
  ResponseDeleted = 3,
  PreVerify = 4,
  AdminVerify = 5,
  Disabled = 6,
}

export enum UserRole {
  Admin = 0,
  User = 1,
  Guest = 2,
  Support = 3,
  Viewer = 4,
  Contributor = 5,
  Developer = 6,
  Tester = 7,
  Partner = 8,
}

export class UserInfo {
  id?: number
  name: string
  email: string
  password: string
  status: Status
  createTime: string
  verifyTime?: string
  visitTime?: string
  avatar?: string
  description?: string
  updateTime?: string
  roles?: UserRole[]
  remark?: string
  constructor(email: string, password: string) {
    this.name = email
    this.email = email
    this.password = password
    this.status = Status.PreVerify
    this.createTime = new Date().toLocaleString()
    this.verifyTime = undefined
    this.visitTime = undefined
    this.updateTime = new Date().toLocaleString()
    this.roles = [UserRole.User]
    this.remark = undefined
  }
}

export class UserOption {
  id?: number
  name?: string
  email?: string
  roles?: UserRole[]
  remark?: string
}

// https://platform.openai.com/docs/models/overview
export type CHATMODEL = 'gpt-3.5-turbo' | 'gpt-3.5-turbo-16k' | 'gpt-3.5-turbo-0125' | 'gpt-3.5-turbo-1106' |
'gpt-4' | 'gpt-4-32k' | 'gpt-4-turbo-preview' | 'gpt-4-0125-preview' | 'gpt-4-0613' | 'gpt-4-32k-0613' | 'gpt-4-all' |
'gpt-4-gizmo' | 'gpt-4-turbo' | 'gpt-4-turbo-2024-04-09' | 'gpt-4o' | 'gpt-4o-2024-08-06' | 'gpt-4o-all' | 'o1-preview' |
'o1-preview-2024-09-12' | 'o1' | 'o1-2024-12-17' | 'o1-mini' | 'o1-mini-2024-09-12' | 'dall-e-2' | 'dall-e-3' | 'gemini-pro' | 'gemini-1.5-pro' |
'gemini-1.5-pro-exp-0827' | 'gemini-2.0-flash-exp' | 'gemini-2.0-flash-thinking-exp' | 'gemini-exp-1206' | 'claude-2' | 'claude-3-sonnet' | 'claude-3.5-sonnet' | 'claude-3-opus' | 'claude-3-haiku' |
'glm-4-air' | 'glm-4-airx' | 'glm-4' | 'glm-4-flash' | 'glm-4-0520' | 'glm-4-plus' | 'glm-zero-preview' | 'qwen-turbo' | 'codegeex-4' |
'qwen-plus' | 'qwen-max' | 'yi-large' | 'yi-medium' | 'yi-medium-200k' | 'yi-spark' | 'yi-large-rag' | 'yi-large-turbo' | 'yi-vl-plus' | 'yi-lightning' |
'yi-lightning-lite' | 'SparkDesk-v3.5' | 'SparkDesk-v4.0' | 'command-r' | 'command-r-plus' | 'command-r-plus-online' |
'moonshot-v1-8k' | 'moonshot-v1-32k' | 'moonshot-v1-128k' | 'concise' | 'detail' | 'research' | 'step-1-32k' | 'step-1-200k' |
'deepseek-chat' | 'deepseek-coder'

export const CHATMODELS: CHATMODEL[] = [
  'gpt-3.5-turbo', 'gpt-3.5-turbo-16k', 'gpt-3.5-turbo-0125', 'gpt-3.5-turbo-1106', 'gpt-4', 'gpt-4-32k',
  'gpt-4-turbo-preview', 'gpt-4-0125-preview', 'gpt-4-0613', 'gpt-4-32k-0613', 'gpt-4-all', 'gpt-4-gizmo',
  'gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'gpt-4o', 'gpt-4o-2024-08-06', 'gpt-4o-all', 'o1-preview', 'o1-preview-2024-09-12',
  'o1', 'o1-2024-12-17', 'o1-mini', 'o1-mini-2024-09-12', 'dall-e-2', 'dall-e-3', 'gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-pro-exp-0827', 'gemini-2.0-flash-exp',
  'gemini-2.0-flash-thinking-exp', 'gemini-exp-1206', 'claude-2', 'claude-3-sonnet', 'claude-3.5-sonnet', 'claude-3-opus', 'claude-3-haiku',
  'glm-4-air', 'glm-4-airx', 'glm-4', 'glm-4-flash', 'glm-4-0520', 'glm-4-plus', 'glm-zero-preview', 'qwen-turbo',
  'qwen-plus', 'qwen-max', 'yi-large', 'yi-medium', 'yi-medium-200k', 'yi-vl-plus', 'yi-spark', 'yi-large-rag',
  'yi-large-turbo', 'yi-lightning', 'yi-lightning-lite', 'SparkDesk-v3.5', 'SparkDesk-v4.0', 'command-r',
  'command-r-plus', 'command-r-plus-online', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'concise',
  'detail', 'research', 'step-1-32k', 'step-1-200k', 'deepseek-chat', 'deepseek-coder',
  'codegeex-4',
]

export const chatModelOptions = [
  'gpt-3.5-turbo', 'gpt-3.5-turbo-16k', 'gpt-3.5-turbo-0125', 'gpt-3.5-turbo-1106', 'gpt-4', 'gpt-4-32k',
  'gpt-4-turbo-preview', 'gpt-4-0125-preview', 'gpt-4-0613', 'gpt-4-32k-0613', 'gpt-4-all', 'gpt-4-gizmo',
  'gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'gpt-4o', 'gpt-4o-2024-08-06', 'gpt-4o-all', 'o1-preview', 'o1-preview-2024-09-12',
  'o1', 'o1-2024-12-17', 'o1-mini', 'o1-mini-2024-09-12', 'dall-e-2', 'dall-e-3', 'gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-pro-exp-0827', 'gemini-2.0-flash-exp',
  'gemini-2.0-flash-thinking-exp', 'gemini-exp-1206', 'claude-2', 'claude-3-sonnet', 'claude-3.5-sonnet', 'claude-3-opus', 'claude-3-haiku',
  'glm-4-air', 'glm-4-airx', 'glm-4', 'glm-4-flash', 'glm-4-0520', 'glm-4-plus', 'glm-zero-preview', 'qwen-turbo',
  'qwen-plus', 'qwen-max', 'yi-large', 'yi-medium', 'yi-medium-200k', 'yi-vl-plus', 'yi-spark', 'yi-large-rag',
  'yi-large-turbo', 'yi-lightning', 'yi-lightning-lite', 'SparkDesk-v3.5', 'SparkDesk-v4.0', 'command-r',
  'command-r-plus', 'command-r-plus-online', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'concise',
  'detail', 'research', 'step-1-32k', 'step-1-200k', 'deepseek-chat', 'deepseek-coder',
  'codegeex-4',
].map((model: string) => {
  const label = model
  return {
    label,
    key: model,
    value: model,
  }
})

export class ChatRoom {
  id?: number
  roomId: number
  userId: string
  title: string
  prompt: string = ''
  usingContext: boolean
  status: Status = Status.Normal
  chatModel: CHATMODEL
  constructor(userId: string, title: string, roomId: number) {
    this.userId = userId
    this.title = title
    this.roomId = roomId
    this.usingContext = true
    this.chatModel = 'gpt-3.5-turbo'
  }
}

export class ChatOptions {
  parentMessageId: string | undefined = undefined
  messageId: string | undefined = undefined
  conversationId: string | undefined = undefined
  prompt_tokens: number | undefined = undefined
  completion_tokens: number | undefined = undefined
  total_tokens: number | undefined = undefined
  estimated: boolean | undefined = undefined

  constructor(parentMessageId?: string, messageId?: string, conversationId?: string) {
    if (parentMessageId) this.parentMessageId = parentMessageId
    if (messageId) this.messageId = messageId
    if (conversationId) this.conversationId = conversationId
  }
}

export class previousResponse {
  response: string = ''
  options: ChatOptions = new ChatOptions()

  constructor(response: string, options: ChatOptions) {
    this.response = response
    this.options = options
  }
}

export class ChatInfo {
  id?: number
  roomId: number
  uuid: number
  dateTime: number
  prompt: string
  response?: string
  status: Status = Status.Normal
  options: ChatOptions
  previousResponse?: previousResponse[]
  constructor(roomId: number, uuid: number, prompt: string, options: ChatOptions) {
    this.roomId = roomId
    this.uuid = uuid
    this.prompt = prompt
    this.options = options
    this.dateTime = new Date().getTime()
  }
}

export class UsageResponse {
  prompt_tokens: number = 0
  completion_tokens: number = 0
  total_tokens: number = 0
  estimated: boolean = false

  constructor(prompt_tokens?: number, completion_tokens?: number, total_tokens?: number, estimated?: boolean) {
    if (prompt_tokens !== undefined) this.prompt_tokens = prompt_tokens
    if (completion_tokens !== undefined) this.completion_tokens = completion_tokens
    if (total_tokens !== undefined) this.total_tokens = total_tokens
    if (estimated !== undefined) this.estimated = estimated
  }
}

export class ChatUsage {
  id?: number
  userId: string
  roomId: number
  chatId: number
  messageId: string
  promptTokens: number = 0
  completionTokens: number = 0
  totalTokens: number = 0
  estimated: boolean = false
  dateTime: number

  constructor(userId: string, roomId: number, chatId: number, messageId: string, usage: UsageResponse) {
    this.userId = userId
    this.roomId = roomId
    this.chatId = chatId
    this.messageId = messageId
    if (usage) {
      this.promptTokens = usage.prompt_tokens
      this.completionTokens = usage.completion_tokens
      this.totalTokens = usage.total_tokens
      this.estimated = usage.estimated
    }
    this.dateTime = new Date().getTime()
  }
}

export class Config {
  id?: number
  constructor(
    public timeoutMs: number,
    public apiKey?: string,
    public apiBaseUrl?: string,
    public apiDisableDebug?: boolean,
    public reverseProxy?: string,
    public socksProxy?: string,
    public socksAuth?: string,
    public httpsProxy?: string,
    public siteConfig?: SiteConfig,
    public mailConfig?: MailConfig,
    public auditConfig?: AuditConfig,
  ) { }
}

export class SiteConfig {
  constructor(
    public siteTitle?: string,
    public loginEnabled?: boolean,
    public loginSalt?: string,
    public registerEnabled?: boolean,
    public registerReview?: boolean,
    public registerMails?: string,
    public siteDomain?: string,
  ) { }
}

export class MailConfig {
  constructor(
    public smtpHost: string,
    public smtpPort: number,
    public smtpTsl: boolean,
    public smtpUserName: string,
    public smtpPassword: string,
  ) { }
}

export class AuditConfig {
  constructor(
    public enabled: boolean,
    public provider: TextAuditServiceProvider,
    public options: TextAuditServiceOptions,
    public textType: TextAudioType,
    public customizeEnabled: boolean,
    public sensitiveWords: string,
  ) { }
}

export enum TextAudioType {
  None = 0,
  Request = 1 << 0, // 二进制 01
  Response = 1 << 1, // 二进制 10
  All = Request | Response, // 二进制 11
}

export class KeyConfig {
  id?: number
  key: string
  apiBaseUrl: string
  chatModels: CHATMODEL[]
  userRoles: UserRole[]
  status: Status
  remark: string
  constructor(key: string, apiBaseUrl: string, chatModels: CHATMODEL[],
    userRoles: UserRole[], remark: string) {
    this.key = key
    this.apiBaseUrl = apiBaseUrl
    this.chatModels = chatModels
    this.userRoles = userRoles
    this.status = Status.Normal
    this.remark = remark
  }
}
