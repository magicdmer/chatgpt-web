import * as dotenv from 'dotenv'
import 'isomorphic-fetch'
import OpenAI from 'openai'
import { SocksProxyAgent } from 'socks-proxy-agent'
import httpsProxyAgent from 'https-proxy-agent'
import fetch from 'node-fetch'
import crypto from 'crypto'
import type { KeyConfig, UserInfo } from '../storage/model'
import { Status } from '../storage/model'
import { getCacheApiKeys, getCacheConfig, getOriginConfig } from '../storage/config'
import { sendResponse } from '../utils'
import { hasAnyRole, isNotEmptyString } from '../utils/is'
import type { ChatContext, ModelConfig } from '../types'
import { getChatByMessageId } from '../storage/sqlite'
import type { RequestOptions, ChatMessage } from './types'
import { executeToolForUser, getToolsForUser, resolveToolForUser } from '../plugins'

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

const _lockedKeys: { key: string; lockedTime: number }[] = []

export async function createClient(key: KeyConfig) {
  const config = await getCacheConfig()
  const OPENAI_API_BASE_URL = config.apiBaseUrl

  const baseURL = key.apiBaseUrl.length !== 0
    ? `${key.apiBaseUrl}/v1`
    : (isNotEmptyString(OPENAI_API_BASE_URL) ? `${OPENAI_API_BASE_URL}/v1` : undefined)

  const customFetch = await setupProxyFetch()

  return new OpenAI({ apiKey: key.key, baseURL, fetch: customFetch as any ?? undefined })
}

// 列出给定密钥/基地地址下的模型列表，用于前端动态刷新
export async function listModelsForKey(key: KeyConfig): Promise<string[]> {
  const client = await createClient(key)
  const list = await client.models.list()
  const data: any[] = (list as any)?.data ?? []
  return data.map((m: any) => m.id).filter((id: string) => typeof id === 'string')
}

const processThreads: { userId: string; abort: AbortController; messageId: string; chatUuid: number }[] = []

async function chatReplyProcess(options: RequestOptions) {
  const chatModel = options.room.chatModel ?? 'gpt-3.5-turbo'
  let model = chatModel as string
  const userId = options.user.id.toString()
  const messageId = options.messageId

  const { message, lastContext, process: streamProcess, systemMessage, temperature, top_p } = options

  if (options.draw) {
    const abort = new AbortController()
    try {
      const { result } = await executeToolForUser(options.user, 'generate_image', { prompt: message }, abort.signal)

      const dataRes = {
        status: 'Success',
        message: '',
        text: result,
      }

      return sendResponse({ type: 'Success', data: dataRes })
    }
    catch (error: any) {
      return sendResponse({ type: 'Fail', message: error.message ?? error })
    }
  }

  const key = await getRandomApiKey(options.user, chatModel)
  if (key == null || key === undefined)
    throw new Error('没有可用的配置。请再试一次 | No available configuration. Please try again.')

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
    const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: any; name?: string; tool_calls?: any[]; tool_call_id?: string }> = []
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
    if (options.visionContent && Array.isArray(options.visionContent) && options.visionContent.length > 0) {
      messages.push({ role: 'user', content: options.visionContent })
    }
    else {
      messages.push({ role: 'user', content: message })
    }

    const client = await createClient(key)
    const abort = new AbortController()
    processThreads.push({ userId, abort, messageId, chatUuid: options.chatUuid })

    const conversationId = lastContext?.conversationId ?? crypto.randomUUID()
    // Accumulate raw streamed text, and derive final text and reasoning content
    let rawText = ''
    let finishReason: string | null = null
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; estimated?: boolean } | undefined
    // Track reasoning content when models expose it as a dedicated field
    let reasoningFull = ''
    let lastThinkingLen = 0

    const tools = await getToolsForUser(options.user)
    if (model.toLowerCase().startsWith('gemini-') && model.toLowerCase().includes('flash')) {
      tools.push({
        type: 'function',
        function: {
          name: 'googleSearch',
          description: 'Search Google for up-to-date information.',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      })
    }

    let maxTurns = 5
    let finalResponseSent = false

    while (maxTurns-- > 0 && !finalResponseSent) {
      finishReason = null
      let toolCalls: { index: number, id: string, type: 'function', function: { name: string, arguments: string } }[] = []
      let isToolCall = false
      let turnText = ''

      const stream = await client.chat.completions.create({
        model,
        messages: messages as any,
        temperature,
        top_p,
        stream: true,
        ...(tools && tools.length > 0 ? { tools } : {}),
      }, { signal: abort.signal, timeout: timeoutMs })

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0]
        const delta = choice?.delta as any

        if (delta?.tool_calls) {
          isToolCall = true
          for (const tc of delta.tool_calls) {
            const index = tc.index
            if (!toolCalls[index]) {
              toolCalls[index] = {
                index,
                id: tc.id,
                type: 'function',
                function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' }
              }
            } else {
              if (tc.function?.name) toolCalls[index].function.name += tc.function.name
              if (tc.function?.arguments) toolCalls[index].function.arguments += tc.function.arguments
            }
          }
        }

        const contentDelta = delta?.content ?? ''
        if (contentDelta) {
          rawText += contentDelta
          turnText += contentDelta
        }
        finishReason = choice?.finish_reason ?? null

        // Prefer dedicated reasoning content if provided by the SDK/model
        const reasoningChunk = delta?.reasoning_content ?? ''
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
          id: chunk.id ?? crypto.randomUUID(),
          conversationId,
          role: 'assistant',
          text: finalText,
          thinking: thinkingDelta || undefined,
          detail: { choices: [{ finish_reason: finishReason }] },
        }
        streamProcess?.(partial)
      }

      if (isToolCall && toolCalls.length > 0) {
        const validToolCalls = toolCalls.filter(Boolean)
        messages.push({
          role: 'assistant',
          content: turnText || null,
          tool_calls: validToolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }))
        })

        for (const tc of validToolCalls) {
          const pluginName = tc.function.name
          const shouldExposeToolResult = pluginName === 'generate_image'
          const runtime = await resolveToolForUser(options.user, pluginName)
          const displayName = runtime?.plugin.manifest.name || pluginName

          streamProcess?.({
            id: messageId,
            conversationId,
            role: 'assistant',
            text: rawText,
            toolStatus: `正在调用插件 [${displayName}]...`,
            detail: { choices: [{ finish_reason: null }] }
          })

          let result = ''
          try {
            const args = JSON.parse(tc.function.arguments)
            result = (await executeToolForUser(options.user, pluginName, args, abort.signal)).result
          }
          catch (err: any) {
            result = `Error executing plugin: ${err.message}`
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: pluginName,
            content: result
          })

          if (shouldExposeToolResult && result)
            rawText += `${result}\n\n`

          if (shouldExposeToolResult && result)
            turnText += `${result}\n\n`

          streamProcess?.({
            id: messageId,
            conversationId,
            role: 'assistant',
            text: rawText,
            toolStatus: undefined,
            detail: { choices: [{ finish_reason: null }] }
          })
        }
      } else if (options.autoContinue && finishReason === 'length' && maxTurns > 0) {
        messages.push({
          role: 'assistant',
          content: turnText,
        })
        messages.push({
          role: 'user',
          content: 'Continue exactly where you left off. Do not repeat any previous content.',
        })
      } else {
        finalResponseSent = true
      }
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
    const index = processThreads.findIndex(d => d.messageId === messageId)
    if (index > -1)
      processThreads.splice(index, 1)
  }
}

export function abortChatProcess(chatUuid: number) {
  const index = processThreads.findIndex(d => d.chatUuid === chatUuid)
  if (index <= -1)
    return
  const messageId = processThreads[index].messageId
  processThreads[index].abort.abort()
  processThreads.splice(index, 1)
  return messageId
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

export async function generateChatTitle(user: UserInfo, model: string, userMessage: string, assistantMessage: string): Promise<string> {
  const key = await getRandomApiKey(user, model)
  if (!key)
    throw new Error(`未找到当前用户可用的标题总结模型 ${model}`)

  const client = await createClient(key)
  const timeoutMs = (await getCacheConfig()).timeoutMs
  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: '根据首轮对话生成一个简短的会话标题。中文使用 6 到 15 个字，英文使用 3 到 8 个单词。只输出标题，不要引号、句号、Markdown 或解释。',
      },
      {
        role: 'user',
        content: `用户：${userMessage.slice(0, 4000)}\n\n助手：${assistantMessage.slice(0, 4000)}`,
      },
    ],
  }, { timeout: timeoutMs })

  return String(completion.choices?.[0]?.message?.content || '')
}

export type { ChatContext, ChatMessage }

export { chatReplyProcess, chatConfig }
