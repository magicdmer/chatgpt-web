import type { ChatRoom, UserInfo } from 'src/storage/model'

export interface ChatMessage {
  id: string
  conversationId?: string
  parentMessageId?: string
  role: 'user' | 'assistant' | 'system'
  text: string
  // Optional incremental reasoning content for streaming updates
  thinking?: string
  toolStatus?: string
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
  images?: string[]
  visionContent?: any[]
  lastContext?: { conversationId?: string; parentMessageId?: string }
  process?: (chat: ChatMessage) => void
  systemMessage?: string
  temperature?: number
  top_p?: number
  user: UserInfo
  messageId: string
  chatUuid: number
  tryCount: number
  room: ChatRoom
  draw?: boolean
  autoContinue?: boolean
}

export interface BalanceResponse {
  total_usage: number
}
