import type { ObjectId } from 'mongodb'
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
  _id: ObjectId
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
    this.verifyTime = null
    this.visitTime = null
    this.updateTime = new Date().toLocaleString()
    this.roles = [UserRole.User]
    this.remark = null
  }
}

export class UserOption {
  _id?: string
  name?: string
  email?: string
  roles?: UserRole[]
  remark?: string
}

// https://platform.openai.com/docs/models/overview
export type CHATMODEL = 'gpt-3.5-turbo' | 'gpt-3.5-turbo-16k' | 'gpt-3.5-turbo-0125' | 'gpt-3.5-turbo-1106' |
'gpt-4' | 'gpt-4-32k' | 'gpt-4-turbo-preview' | 'gpt-4-0125-preview' | 'gpt-4-0613' | 'gpt-4-32k-0613' | 'gpt-4-all' |
'gpt-4-gizmo' | 'text-embedding-ada-002' | 'dall-e-2' | 'dall-e-3' | 'gemini-pro' | 'gemini-pro-vision' | 'claude-2' |
'claude-3-sonnet' | 'claude-3-opus' | 'claude-3-haiku' | 'glm-3-turbo' | 'glm-4' | 'qwen-turbo' | 'qwen-plus' | 'qwen-max' |
'yi-34b-chat-0205' | 'yi-34b-chat-200k' | 'yi-vl-plus' | 'SparkDesk-v3.5' | 'command-r' | 'command-r-plus' |
'moonshot-v1-8k' | 'moonshot-v1-32k' | 'moonshot-v1-128k' | 'gpt-3.5-turbo-online-with-gs' | 'gpt-4-online-with-gs' |
'gpt-4-1106-preview-online-with-gs'

export const CHATMODELS: CHATMODEL[] = [
  'gpt-3.5-turbo', 'gpt-3.5-turbo-16k', 'gpt-3.5-turbo-0125', 'gpt-3.5-turbo-1106', 'gpt-4', 'gpt-4-32k',
  'gpt-4-turbo-preview', 'gpt-4-0125-preview', 'gpt-4-0613', 'gpt-4-32k-0613', 'gpt-4-all', 'gpt-4-gizmo',
  'text-embedding-ada-002', 'dall-e-2', 'dall-e-3', 'gemini-pro', 'gemini-pro-vision', 'claude-2', 'claude-3-sonnet',
  'claude-3-opus', 'claude-3-haiku', 'glm-3-turbo', 'glm-4', 'qwen-turbo', 'qwen-plus', 'qwen-max', 'yi-34b-chat-0205',
  'yi-34b-chat-200k', 'yi-vl-plus', 'SparkDesk-v3.5', 'command-r', 'command-r-plus', 'moonshot-v1-8k', 'moonshot-v1-32k',
  'moonshot-v1-128k', 'gpt-3.5-turbo-online-with-gs', 'gpt-4-online-with-gs', 'gpt-4-1106-preview-online-with-gs',
]

export const chatModelOptions = [
  'gpt-3.5-turbo', 'gpt-3.5-turbo-16k', 'gpt-3.5-turbo-0125', 'gpt-3.5-turbo-1106', 'gpt-4', 'gpt-4-32k',
  'gpt-4-turbo-preview', 'gpt-4-0125-preview', 'gpt-4-0613', 'gpt-4-32k-0613', 'gpt-4-all', 'gpt-4-gizmo',
  'text-embedding-ada-002', 'dall-e-2', 'dall-e-3', 'gemini-pro', 'gemini-pro-vision', 'claude-2', 'claude-3-sonnet',
  'claude-3-opus', 'claude-3-haiku', 'glm-3-turbo', 'glm-4', 'qwen-turbo', 'qwen-plus', 'qwen-max', 'yi-34b-chat-0205',
  'yi-34b-chat-200k', 'yi-vl-plus', 'SparkDesk-v3.5', 'command-r', 'command-r-plus', 'moonshot-v1-8k', 'moonshot-v1-32k',
  'moonshot-v1-128k', 'gpt-3.5-turbo-online-with-gs', 'gpt-4-online-with-gs', 'gpt-4-1106-preview-online-with-gs',
].map((model: string) => {
  const label = model
  return {
    label,
    key: model,
    value: model,
  }
})

export class ChatRoom {
  _id: ObjectId
  roomId: number
  userId: string
  title: string
  prompt: string
  usingContext: boolean
  status: Status = Status.Normal
  // only access token used
  accountId?: string
  chatModel: CHATMODEL
  constructor(userId: string, title: string, roomId: number) {
    this.userId = userId
    this.title = title
    this.prompt = undefined
    this.roomId = roomId
    this.usingContext = true
    this.accountId = null
    this.chatModel = 'gpt-3.5-turbo'
  }
}

export class ChatOptions {
  parentMessageId?: string
  messageId?: string
  conversationId?: string
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  estimated?: boolean
  constructor(parentMessageId?: string, messageId?: string, conversationId?: string) {
    this.parentMessageId = parentMessageId
    this.messageId = messageId
    this.conversationId = conversationId
  }
}

export class previousResponse {
  response: string
  options: ChatOptions
}

export class ChatInfo {
  _id: ObjectId
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
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  estimated: boolean
}

export class ChatUsage {
  _id: ObjectId
  userId: ObjectId
  roomId: number
  chatId: ObjectId
  messageId: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimated: boolean
  dateTime: number
  constructor(userId: ObjectId, roomId: number, chatId: ObjectId, messageId: string, usage: UsageResponse) {
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
  constructor(
    public _id: ObjectId,
    public timeoutMs: number,
    public apiKey?: string,
    public apiDisableDebug?: boolean,
    public accessToken?: string,
    public apiBaseUrl?: string,
    public apiModel?: APIMODEL,
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
  _id: ObjectId
  key: string
  apiBaseUrl: string
  keyModel: APIMODEL
  chatModels: CHATMODEL[]
  userRoles: UserRole[]
  status: Status
  remark: string
  constructor(key: string, apiBaseUrl: string, keyModel: APIMODEL, chatModels: CHATMODEL[],
    userRoles: UserRole[], remark: string) {
    this.key = key
    this.apiBaseUrl = apiBaseUrl
    this.keyModel = keyModel
    this.chatModels = chatModels
    this.userRoles = userRoles
    this.status = Status.Normal
    this.remark = remark
  }
}

export type APIMODEL = 'ChatGPTAPI' | 'ChatGPTUnofficialProxyAPI'
