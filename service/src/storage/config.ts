import * as dotenv from 'dotenv'
import { isNotEmptyString } from '../utils/is'
import { Config, KeyConfig, MailConfig, SiteConfig, UserRole, chatModelOptions } from './model'
import { getConfig, getKeys, upsertKey } from './sqlite'

dotenv.config()

let cachedConfig: Config | undefined
let cacheExpiration = 0

export async function getCacheConfig(): Promise<Config> {
  const now = Date.now()
  if (cachedConfig && cacheExpiration > now)
    return Promise.resolve(cachedConfig)

  const loadedConfig = await getOriginConfig()

  cachedConfig = loadedConfig
  cacheExpiration = now + 10 * 60 * 1000

  return Promise.resolve(cachedConfig)
}

export async function getOriginConfig() {
  let config = await getConfig()
  if (config == null) {
    config = new Config(
      !isNaN(+process.env.TIMEOUT_MS) ? +process.env.TIMEOUT_MS : 600 * 1000,
      process.env.OPENAI_API_KEY,
      process.env.OPENAI_API_BASE_URL,
      process.env.OPENAI_API_DISABLE_DEBUG === 'true',
      (process.env.SOCKS_PROXY_HOST && process.env.SOCKS_PROXY_PORT)
        ? (`${process.env.SOCKS_PROXY_HOST}:${process.env.SOCKS_PROXY_PORT}`)
        : '',
      (process.env.SOCKS_PROXY_USERNAME && process.env.SOCKS_PROXY_PASSWORD)
        ? (`${process.env.SOCKS_PROXY_USERNAME}:${process.env.SOCKS_PROXY_PASSWORD}`)
        : '',
      process.env.HTTPS_PROXY,
      new SiteConfig(
        process.env.SITE_TITLE || 'ChatGpt Web',
        isNotEmptyString(process.env.AUTH_SECRET_KEY),
        process.env.AUTH_SECRET_KEY,
        process.env.REGISTER_ENABLED === 'true',
        process.env.REGISTER_REVIEW === 'true',
        process.env.REGISTER_MAILS,
        process.env.SITE_DOMAIN),
      new MailConfig(process.env.SMTP_HOST,
        !isNaN(+process.env.SMTP_PORT) ? +process.env.SMTP_PORT : 465,
        process.env.SMTP_TSL === 'true',
        process.env.SMTP_USERNAME,
        process.env.SMTP_PASSWORD))
  }
  else {
    if (config.siteConfig.loginEnabled === undefined)
      config.siteConfig.loginEnabled = isNotEmptyString(process.env.AUTH_SECRET_KEY)
    if (config.siteConfig.loginSalt === undefined)
      config.siteConfig.loginSalt = process.env.AUTH_SECRET_KEY
    if (config.apiDisableDebug === undefined)
      config.apiDisableDebug = process.env.OPENAI_API_DISABLE_DEBUG === 'true'
    if (config.socksAuth === undefined) {
      config.socksAuth = (process.env.SOCKS_PROXY_USERNAME && process.env.SOCKS_PROXY_PASSWORD)
        ? (`${process.env.SOCKS_PROXY_USERNAME}:${process.env.SOCKS_PROXY_PASSWORD}`)
        : ''
    }
    if (config.siteConfig.registerReview === undefined)
      config.siteConfig.registerReview = process.env.REGISTER_REVIEW === 'true'
  }
  return config
}

export function clearConfigCache() {
  cacheExpiration = 0
  cachedConfig = undefined
  ;(globalThis as any).__siteDomainCache = undefined
}

let apiKeysCachedConfig: KeyConfig[] | undefined
let apiKeysCacheExpiration = 0

export async function getCacheApiKeys(): Promise<KeyConfig[]> {
  const now = Date.now()
  if (apiKeysCachedConfig && apiKeysCacheExpiration > now)
    return Promise.resolve(apiKeysCachedConfig)

  const loadedConfig = (await getApiKeys()).keys

  apiKeysCachedConfig = loadedConfig
  apiKeysCacheExpiration = now + 10 * 60 * 1000

  return Promise.resolve(apiKeysCachedConfig)
}

export function clearApiKeyCache() {
  apiKeysCacheExpiration = 0
  getCacheApiKeys()
}

export async function getApiKeys() {
  const result = await getKeys()
  result.keys.forEach((key) => {
    if (key.userRoles == null || key.userRoles.length <= 0) {
      key.userRoles.push(UserRole.Admin)
      key.userRoles.push(UserRole.User)
      key.userRoles.push(UserRole.Guest)
    }
    if (key.chatModels == null || key.chatModels.length <= 0) {
      key.chatModels = chatModelOptions.map(option => option.value)
    }
    if (!key.availableModels) {
      key.availableModels = []
    }
  })
  return result
}
