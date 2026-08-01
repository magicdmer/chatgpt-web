import type { JwtPayload } from 'jsonwebtoken'

export interface RequestProps {
  roomId: number
  uuid: number
  regenerate: boolean
  prompt: string
  images?: string[]
  options?: ChatContext
  systemMessage: string
  temperature?: number
  top_p?: number
  draw?: boolean
  autoContinue?: boolean
}

export interface ChatContext {
  conversationId?: string
  parentMessageId?: string
}

export interface ModelConfig {
  timeoutMs?: number
  socksProxy?: string
  socksAuth?: string
  httpsProxy?: string
  allowRegister?: boolean
  balance?: string
}

export interface AuthJwtPayload extends JwtPayload {
  name: string
  avatar: string
  description: string
  userId: string
  root: boolean
}
