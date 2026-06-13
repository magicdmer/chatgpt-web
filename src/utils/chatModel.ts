import { useAuthStoreWithout } from '@/store/modules/auth'

const FALLBACK_CHAT_MODEL = 'gpt-3.5-turbo'

/**
 * 计算新建会话应使用的默认对话模型。
 * 优先级：用户个人默认 → 站点默认 → 当前角色可用模型的第一个 → 静态兜底。
 * 用户/站点默认都会先经过「是否在当前用户可用模型集内」的校验，
 * 避免落到一个该用户根本无权使用的模型上（例如把绘图模型当默认）。
 */
export function getDefaultChatModel(): string {
  const authStore = useAuthStoreWithout()
  const session = authStore.session

  const allowed = (session?.chatModels ?? [])
    .map((o: any) => o?.value ?? o?.key ?? o?.label)
    .filter(Boolean) as string[]

  const pick = (model?: string) => (model && allowed.includes(model)) ? model : undefined

  return pick(session?.userInfo?.config?.chatModel)
    ?? pick(session?.defaultChatModel)
    ?? allowed[0]
    ?? FALLBACK_CHAT_MODEL
}
