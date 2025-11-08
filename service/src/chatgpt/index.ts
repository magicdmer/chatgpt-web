import * as dotenv from 'dotenv'
import 'isomorphic-fetch'
import OpenAI from 'openai'
import { SocksProxyAgent } from 'socks-proxy-agent'
import httpsProxyAgent from 'https-proxy-agent'
import fetch from 'node-fetch'
import axios from 'axios'
import crypto from 'crypto'
import type { AuditConfig, KeyConfig, UserInfo } from '../storage/model'
import { Status } from '../storage/model'
import type { TextAuditService } from '../utils/textAudit'
import { textAuditServices } from '../utils/textAudit'
import { getCacheApiKeys, getCacheConfig, getOriginConfig } from '../storage/config'
import { sendResponse } from '../utils'
import { hasAnyRole, isNotEmptyString } from '../utils/is'
import type { ChatContext, ModelConfig } from '../types'
import { getChatByMessageId } from '../storage/sqlite'
import type { RequestOptions, ChatMessage } from './types'

const { HttpsProxyAgent } = httpsProxyAgent

dotenv.config()

const ErrorCodeMessage: Record<string, string> = {
  401: '[OpenAI] 提供错误的API密钥 | Incorrect API key provided',
  403: '[OpenAI] 服务器拒绝访问，请稍后再试 | Server refused to access, please try again later',
  502: '[OpenAI] 错误的网关 |  Bad Gateway',
  503: '[OpenAI] 服务器繁忙，请稍后再试 | Server is busy, please try again later',
  504: '[OpenAI] 网关超时 | Gateway Time-out',
  500: '[OpenAI] 服务器繁忙，请稍后再试 | Internal Server Error',
}

let auditService: TextAuditService
const _lockedKeys: { key: string; lockedTime: number }[] = []

export async function createClient(key: KeyConfig) {
  // More Info: https://github.com/transitive-bullshit/chatgpt-api

  const config = await getCacheConfig()
  const OPENAI_API_BASE_URL = config.apiBaseUrl

  const baseURL = key.apiBaseUrl.length !== 0
    ? `${key.apiBaseUrl}/v1`
    : (isNotEmptyString(OPENAI_API_BASE_URL) ? `${OPENAI_API_BASE_URL}/v1` : undefined)

  const customFetch = await setupProxyFetch()

  return new OpenAI({ apiKey: key.key, baseURL, fetch: customFetch ?? undefined })
}

// 列出给定密钥/基地地址下的模型列表，用于前端动态刷新
export async function listModelsForKey(key: KeyConfig): Promise<string[]> {
  const client = await createClient(key)
  try {
    const list = await client.models.list()
    const data: any[] = (list as any)?.data ?? []
    return data.map((m: any) => m.id).filter((id: string) => typeof id === 'string')
  }
  catch (err) {
    return []
  }
}

async function draw(url: string, key: string, prompt: string, model: string): Promise<string> {
  let jsondata = {}
  if (model === 'dall-e-2') {
    jsondata = {
      model,
      prompt,
      n: 1,
      size: '512x512',
    }
  }
  else {
    jsondata = {
      model,
      prompt,
      n: 1,
      size: '1024x1024',
    }
  }

  try {
    const response = await axios.post(url, jsondata, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
    })

    const imageUrl = `![我的图片](${response.data.data[0].url})`
    return imageUrl
  }
  catch (error) {
    console.error(error)
    throw error
  }
}

const processThreads: { userId: string; abort: AbortController; messageId: string }[] = []

async function chatReplyProcess(options: RequestOptions) {
  const chatModel = options.room.chatModel ?? 'gpt-3.5-turbo'
  let model = chatModel as string
  const key = await getRandomApiKey(options.user, chatModel)
  const userId = options.user.id.toString()
  const messageId = options.messageId
  if (key == null || key === undefined)
    throw new Error('没有可用的配置。请再试一次 | No available configuration. Please try again.')

  const { message, lastContext, process, systemMessage, temperature, top_p } = options

  if (chatModel === 'dall-e-2' || chatModel === 'dall-e-3') {
    try {
      const imageUrl = await draw(`${key.apiBaseUrl}/v1/images/generations`, key.key, message, chatModel)
      const dataRes = {
        status: 'Success',
        message: '',
        text: imageUrl,
      }

      return sendResponse({ type: 'Success', data: dataRes })
    }
    catch (error) {
      return sendResponse({ type: 'Fail', message: error })
    }
  }

  try {
    const timeoutMs = (await getCacheConfig()).timeoutMs

    // gizmo 相关：官方不支持，保持兼容但不真正开启
    let systemMsg = systemMessage
    if (isNotEmptyString(systemMsg)) {
      if (systemMsg.startsWith('g-') && systemMsg.length === 11 && chatModel === 'gpt-4-all') {
        systemMsg = ''
      }
      else if (systemMsg.startsWith('g-') && systemMsg.length === 11 && chatModel === 'gpt-4-gizmo') {
        model = `gpt-4-gizmo-${systemMsg}`
        systemMsg = ''
      }
      else if (systemMsg.startsWith('g-') && systemMsg.length === 11) {
        systemMsg = ''
      }
    }

    // 构造消息上下文
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
    if (isNotEmptyString(systemMsg)) messages.push({ role: 'system', content: systemMsg })
    if (lastContext?.parentMessageId) {
      let pid: string | undefined = lastContext.parentMessageId
      const backlog: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
      let safety = 20
      while (pid && safety-- > 0) {
        const m = await getMessageById(pid)
        if (!m) break
        if (m.role === 'user' || m.role === 'assistant')
          backlog.unshift({ role: m.role, content: m.text })
        pid = m.parentMessageId
      }
      messages.push(...backlog)
    }
    messages.push({ role: 'user', content: message })

    const client = await createClient(key)
    const abort = new AbortController()
    processThreads.push({ userId, abort, messageId })

    const conversationId = lastContext?.conversationId ?? crypto.randomUUID()
    // Accumulate raw streamed text, and derive final text and reasoning content
    let rawText = ''
    let finishReason: string | null = null
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; estimated?: boolean } | undefined
    // Track reasoning content when models expose it as a dedicated field
    let reasoningFull = ''
    let lastThinkingLen = 0

    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature,
      top_p,
      stream: true,
      ...(options.extra_body ? { extra_body: options.extra_body } : {}),
    }, { signal: abort.signal, timeout: timeoutMs })

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      const delta = choice?.delta?.content ?? ''
      if (delta) rawText += delta
      finishReason = choice?.finish_reason ?? null

      // Prefer dedicated reasoning content if provided by the SDK/model
      const reasoningChunk = (choice?.delta as any)?.reasoning_content ?? ''
      if (reasoningChunk) reasoningFull += reasoningChunk
      // Some providers may only send final message.reasoning_content on the last chunk
      const reasoningMessage = (choice as any)?.message?.reasoning_content ?? ''
      if (!reasoningChunk && reasoningMessage)
        reasoningFull = reasoningMessage

      // Extract reasoning content enclosed within <think>...</think> as a fallback
      let thinkingText = ''
      if (!reasoningChunk) {
        const thinkOpen = rawText.indexOf('<think>')
        const thinkClose = rawText.indexOf('</think>')
        if (thinkOpen !== -1) {
          if (thinkClose !== -1 && thinkClose > thinkOpen) {
            thinkingText = rawText.substring(thinkOpen + 7, thinkClose)
          }
          else {
            thinkingText = rawText.substring(thinkOpen + 7)
          }
        }
      }

      // Compute final visible text by removing <think>...</think> block (or truncating after <think> if not closed yet)
      let finalText: string
      if (!reasoningChunk) {
        const thinkOpen = rawText.indexOf('<think>')
        const thinkClose = rawText.indexOf('</think>')
        if (thinkOpen !== -1) {
          if (thinkClose !== -1 && thinkClose > thinkOpen) {
            finalText = rawText.slice(0, thinkOpen) + rawText.slice(thinkClose + 8)
          }
          else {
            finalText = rawText.slice(0, thinkOpen)
          }
        }
        else {
          finalText = rawText
        }
      }
      else {
        // When reasoning is separate, visible content stays as-is
        finalText = rawText
      }

      // Only send incremental delta of thinking content this turn
      const thinkingDelta = reasoningChunk
        ? reasoningChunk
        : (reasoningMessage
          ? reasoningMessage
          : (thinkingText.length > lastThinkingLen ? thinkingText.substring(lastThinkingLen) : ''))
      if (!reasoningChunk && thinkingText.length > lastThinkingLen)
        lastThinkingLen = thinkingText.length

      const partial: ChatMessage = {
        id: chunk.id,
        conversationId,
        role: 'assistant',
        text: finalText,
        thinking: thinkingDelta || undefined,
        detail: { choices: [{ finish_reason: finishReason }] },
      }
      process?.(partial)
    }

    // usage 可能在最终块返回，若没有则由路由层估算兜底
    if (!usage) usage = { estimated: true }

    return sendResponse({
      type: 'Success',
      data: {
        id: messageId,
        conversationId,
        // On completion, derive final text and full thinking one last time
        text: (() => {
          if (!reasoningFull) {
            const thinkOpen = rawText.indexOf('<think>')
            const thinkClose = rawText.indexOf('</think>')
            if (thinkOpen !== -1) {
              if (thinkClose !== -1 && thinkClose > thinkOpen)
                return rawText.slice(0, thinkOpen) + rawText.slice(thinkClose + 8)
              return rawText.slice(0, thinkOpen)
            }
          }
          return rawText
        })(),
        thinking: (() => {
          if (reasoningFull) return reasoningFull
          const thinkOpen = rawText.indexOf('<think>')
          const thinkClose = rawText.indexOf('</think>')
          if (thinkOpen !== -1) {
            if (thinkClose !== -1 && thinkClose > thinkOpen)
              return rawText.substring(thinkOpen + 7, thinkClose)
            return rawText.substring(thinkOpen + 7)
          }
          return undefined
        })(),
        detail: { usage },
      },
    })
  }
  catch (error: any) {
    const code = error.status ?? error.statusCode
    if (code === 429 && (error.message.includes('Too Many Requests') || error.message.includes('Rate limit'))) {
      if (options.tryCount++ < 3) {
        _lockedKeys.push({ key: key.key, lockedTime: Date.now() })
        await new Promise(resolve => setTimeout(resolve, 2000))
        return await chatReplyProcess(options)
      }
    }
    global.console.error(error)
    if (Reflect.has(ErrorCodeMessage, code))
      return sendResponse({ type: 'Fail', message: ErrorCodeMessage[code] })
    return sendResponse({ type: 'Fail', message: error.message ?? error.error?.message ?? 'Please check the back-end console' })
  }
  finally {
    const index = processThreads.findIndex(d => d.userId === userId)
    if (index > -1)
      processThreads.splice(index, 1)
  }
}

export function abortChatProcess(userId: string) {
  const index = processThreads.findIndex(d => d.userId === userId)
  if (index <= -1)
    return
  const messageId = processThreads[index].messageId
  processThreads[index].abort.abort()
  processThreads.splice(index, 1)
  return messageId
}

export function initAuditService(audit: AuditConfig) {
  if (!audit || !audit.options || !audit.options.apiKey || !audit.options.apiSecret)
    return
  const Service = textAuditServices[audit.provider]
  auditService = new Service(audit.options)
}

async function containsSensitiveWords(audit: AuditConfig, text: string): Promise<boolean> {
  if (audit.customizeEnabled && isNotEmptyString(audit.sensitiveWords)) {
    const textLower = text.toLowerCase()
    const notSafe = audit.sensitiveWords.split('\n').filter(d => textLower.includes(d.trim().toLowerCase())).length > 0
    if (notSafe)
      return true
  }
  if (audit.enabled) {
    if (!auditService)
      initAuditService(audit)
    return await auditService.containsSensitiveWords(text)
  }
  return false
}

async function chatConfig() {
  const config = await getOriginConfig() as ModelConfig
  return sendResponse<ModelConfig>({
    type: 'Success',
    data: config,
  })
}

async function setupProxyFetch(): Promise<typeof fetch | undefined> {
  const config = await getCacheConfig()
  if (isNotEmptyString(config.socksProxy)) {
    const agent = new SocksProxyAgent({
      hostname: config.socksProxy.split(':')[0],
      port: parseInt(config.socksProxy.split(':')[1]),
      userId: isNotEmptyString(config.socksAuth) ? config.socksAuth.split(':')[0] : undefined,
      password: isNotEmptyString(config.socksAuth) ? config.socksAuth.split(':')[1] : undefined,

    })
    return (url, options) => fetch(url, { agent, ...options })
  }
  else {
    if (isNotEmptyString(config.httpsProxy)) {
      const httpsProxy = config.httpsProxy
      if (httpsProxy) {
        const agent = new HttpsProxyAgent(httpsProxy)
        return (url, options) => fetch(url, { agent, ...options })
      }
    }
  }
  return undefined
}

async function getMessageById(id: string): Promise<ChatMessage> {
  const isPrompt = id.startsWith('prompt_')
  const chatInfo = await getChatByMessageId(isPrompt ? id.substring(7) : id)

  if (chatInfo) {
    const parentMessageId = isPrompt
      ? chatInfo.options.parentMessageId
      : `prompt_${id}` // parent message is the prompt

    if (chatInfo.status !== Status.Normal) { // jumps over deleted messages
      return parentMessageId
        ? getMessageById(parentMessageId)
        : undefined
    }
    else {
      if (isPrompt) { // prompt
    return {
          id,
          conversationId: chatInfo.options.conversationId,
          parentMessageId,
          role: 'user',
          text: chatInfo.prompt,
        }
      }
      else {
        return { // completion
          id,
          conversationId: chatInfo.options.conversationId,
          parentMessageId,
      role: 'assistant',
          text: chatInfo.response,
      }
    }
  }
  }
  else { return undefined }
}

async function randomKeyConfig(keys: KeyConfig[]): Promise<KeyConfig | null> {
  if (keys.length <= 0)
    return null
  // cleanup old locked keys
  _lockedKeys.filter(d => d.lockedTime <= Date.now() - 1000 * 20).forEach(d => _lockedKeys.splice(_lockedKeys.indexOf(d), 1))

  let unsedKeys = keys.filter(d => _lockedKeys.filter(l => d.key === l.key).length <= 0)
  const start = Date.now()
  while (unsedKeys.length <= 0) {
    if (Date.now() - start > 3000)
      break
    await new Promise(resolve => setTimeout(resolve, 1000))
    unsedKeys = keys.filter(d => _lockedKeys.filter(l => d.key === l.key).length <= 0)
  }
  if (unsedKeys.length <= 0)
    return null
  const thisKey = unsedKeys[Math.floor(Math.random() * unsedKeys.length)]
  return thisKey
}

async function getRandomApiKey(user: UserInfo, chatModel: string): Promise<KeyConfig | undefined> {
  let keys = (await getCacheApiKeys()).filter(d => hasAnyRole(d.userRoles, user.roles))
    .filter(d => d.chatModels.includes(chatModel)).filter(d => d.status !== Status.Disabled)
  return randomKeyConfig(keys)
}

export type { ChatContext, ChatMessage }

export { chatReplyProcess, chatConfig, containsSensitiveWords }
