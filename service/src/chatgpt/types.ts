import type { ChatRoom, UserInfo } from 'src/storage/model'

export interface ChatMessage {
  id: string
  conversationId?: string
  parentMessageId?: string
  role: 'user' | 'assistant' | 'system'
  text: string
  detail?: {
    choices: Array<{ finish_reason?: string | null }>
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
      estimated?: boolean
    }
  }
}

export interface RequestOptions {
  message: string
  lastContext?: { conversationId?: string; parentMessageId?: string }
  process?: (chat: ChatMessage) => void
  systemMessage?: string
  temperature?: number
  top_p?: number
  user: UserInfo
  messageId: string
  tryCount: number
  room: ChatRoom
}

export interface BalanceResponse {
  total_usage: number
}
