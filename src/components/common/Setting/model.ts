export class ConfigState {
  timeoutMs?: number
  apiKey?: string
  apiBaseUrl?: string
  socksProxy?: string
  socksAuth?: string
  httpsProxy?: string
  balance?: number
  siteConfig?: SiteConfig
  mailConfig?: MailConfig


}

export class UserConfig {
  chatModel?: string
}

export class SiteConfig {
  siteTitle?: string
  loginEnabled?: boolean
  loginSalt?: string
  registerEnabled?: boolean
  registerReview?: boolean
  registerMails?: string
  siteDomain?: string
  defaultChatModel?: string
}

export class MailConfig {
  smtpHost?: string
  smtpPort?: number
  smtpTsl?: boolean
  smtpUserName?: string
  smtpPassword?: string
}
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

export class KeyConfig {
  id?: string
  key: string
  apiBaseUrl: string
  chatModels: string[]
  userRoles: UserRole[]
  status: Status
  remark: string
  constructor(key: string, apiBaseUrl: string, chatModels: string[], 
    userRoles: UserRole[], remark: string) {
    this.key = key
    this.apiBaseUrl = apiBaseUrl
    this.chatModels = chatModels
    this.userRoles = userRoles
    this.status = Status.Normal
    this.remark = remark
  }
}

export const userRoleOptions = Object.values(UserRole).filter(d => isNaN(Number(d))).map((role) => {
  return {
    label: role as string,
    key: role as string,
    value: UserRole[role as keyof typeof UserRole],
  }
})

export class UserInfo {
  id?: string
  email?: string
  password?: string
  roles: UserRole[]
  remark?: string
  constructor(roles: UserRole[]) {
    this.roles = roles
  }
}

export class UserOption {
  id?: string
  name?: string
  email?: string
  roles?: UserRole[]
  remark?: string
}
