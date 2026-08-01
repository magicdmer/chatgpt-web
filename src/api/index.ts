import type { AxiosProgressEvent, GenericAbortSignal } from 'axios'
import { get, post } from '@/utils/request'
import type { ConfigState, KeyConfig, MailConfig, SiteConfig, Status, UserInfo } from '@/components/common/Setting/model'
import { useSettingStore } from '@/store'

export function fetchChatConfig<T = any>() {
  return post<T>({
    url: '/config',
  })
}

export function fetchChatAPIProcess<T = any>(
  params: {
    roomId: number
    uuid: number
    regenerate?: boolean
    prompt: string
    images?: string[]
    options?: { conversationId?: string; parentMessageId?: string }
    signal?: GenericAbortSignal
    draw?: boolean
    autoContinue?: boolean
    onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void },
) {
  const settingStore = useSettingStore()

  let data: Record<string, any> = {
    roomId: params.roomId,
    uuid: params.uuid,
    regenerate: params.regenerate || false,
    prompt: params.prompt,
    images: params.images,
    options: params.options,
    draw: params.draw,
    autoContinue: params.autoContinue,
  }

  data = {
    ...data,
    systemMessage: settingStore.systemMessage,
    temperature: settingStore.temperature,
    top_p: settingStore.top_p,
  }

  return post<T>({
    url: '/chat-process',
    data,
    signal: params.signal,
    onDownloadProgress: params.onDownloadProgress,
  })
}

export function fetchChatStopResponding<T = any>(text: string, messageId: string, conversationId: string, chatUuid?: number) {
  return post<T>({
    url: '/chat-abort',
    data: { text, messageId, conversationId, chatUuid },
  })
}

export function fetchChatResponseoHistory<T = any>(roomId: number, uuid: number, index: number) {
  return get<T>({
    url: '/chat-response-history',
    data: { roomId, uuid, index },
  })
}

export function fetchSession<T>() {
  return post<T>({
    url: '/session',
  })
}

export function fetchVerify<T>(token: string) {
  return post<T>({
    url: '/verify',
    data: { token },
  })
}

export function fetchVerifyAdmin<T>(token: string) {
  return post<T>({
    url: '/verifyadmin',
    data: { token },
  })
}

export function fetchLogin<T = any>(username: string, password: string) {
  return post<T>({
    url: '/user-login',
    data: { username, password },
  })
}

export function fetchSendResetMail<T = any>(username: string) {
  return post<T>({
    url: '/user-send-reset-mail',
    data: { username },
  })
}

export function fetchResetPassword<T = any>(username: string, password: string, sign: string) {
  return post<T>({
    url: '/user-reset-password',
    data: { username, password, sign },
  })
}

export function fetchRegister<T = any>(username: string, password: string) {
  return post<T>({
    url: '/user-register',
    data: { username, password },
  })
}

export function fetchUpdateUserInfo<T = any>(name: string, avatar: string, description: string, chatModel?: string) {
  return post<T>({
    url: '/user-info',
    data: { name, avatar, description, chatModel },
  })
}

export function fetchGetUsers<T = any>(page: number, size: number) {
  return get<T>({
    url: '/users',
    data: { page, size },
  })
}

export function fetchGetAllUserOption<T = any>() {
  return get<T>({
    url: '/userOptions',
  })
}

export function fetchUpdateUserStatus<T = any>(userId: string, status: Status) {
  return post<T>({
    url: '/user-status',
    data: { userId, status },
  })
}

export function fetchUpdateUser<T = any>(userInfo: UserInfo) {
  return post<T>({
    url: '/user-edit',
    data: { userId: userInfo.id, roles: userInfo.roles, email: userInfo.email, password: userInfo.password, remark: userInfo.remark },
  })
}

export function fetchGetChatRooms<T = any>() {
  return get<T>({
    url: '/chatrooms',
  })
}

export function fetchCreateChatRoom<T = any>(title: string, model: string, roomId: number) {
  return post<T>({
    url: '/room-create',
    data: { title, chatModel: model, roomId },
  })
}

export function fetchRenameChatRoom<T = any>(title: string, roomId: number) {
  return post<T>({
    url: '/room-rename',
    data: { title, roomId },
  })
}

export function fetchGenerateChatRoomTitle<T = { title: string; titleSource: Chat.History['titleSource'] }>(roomId: number, prompt: string, response: string) {
  return post<T>({
    url: '/room-title',
    data: { roomId, prompt: prompt.slice(0, 4000), response: response.slice(0, 4000) },
  })
}

export function fetchUpdateChatRoomPrompt<T = any>(prompt: string, roomId: number) {
  return post<T>({
    url: '/room-prompt',
    data: { prompt, roomId },
  })
}

export function fetchUpdateChatRoomUsingContext<T = any>(using: boolean, roomId: number) {
  return post<T>({
    url: '/room-context',
    data: { using, roomId },
  })
}

export function fetchUpdateChatRoomUsingDraw<T = any>(using: boolean, roomId: number) {
  return post<T>({
    url: '/room-draw',
    data: { using, roomId },
  })
}

// 管理员：获取指定密钥的 OpenAI 模型列表（优先使用前端传入的 key/apiBaseUrl）
export function fetchOpenAIModels<T = any>(payload: { key: string; apiBaseUrl?: string; id?: string } | { id: string }) {
  return post<T>({
    url: '/setting-key-models',
    data: payload,
  })
}

// ---- Upload & Image APIs ----
export function fetchUploadImage<T = any>(form: FormData) {
  return post<T>({
    url: '/upload-image',
    data: () => form,
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export function fetchUploadImages<T = any>(form: FormData) {
  return post<T>({
    url: '/upload-images',
    data: () => form,
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export function fetchUpdateChatRoomChatModel<T = any>(model: string, roomId: number) {
  return post<T>({
    url: '/room-chatmodel',
    data: { model, roomId },
  })
}

export function fetchDeleteChatRoom<T = any>(roomId: number) {
  return post<T>({
    url: '/room-delete',
    data: { roomId },
  })
}

export function fetchGetChatHistory<T = any>(roomId: number, lastId?: number) {
  return get<T>({
    url: `/chat-history?roomId=${roomId}&lastId=${lastId}`,
  })
}

export function fetchClearAllChat<T = any>() {
  return post<T>({
    url: '/chat-clear-all',
    data: { },
  })
}

export function fetchClearChat<T = any>(roomId: number) {
  return post<T>({
    url: '/chat-clear',
    data: { roomId },
  })
}

export function fetchDeleteChat<T = any>(roomId: number, uuid: number, inversion?: boolean) {
  return post<T>({
    url: '/chat-delete',
    data: { roomId, uuid, inversion },
  })
}

export function fetchUpdateMail<T = any>(mail: MailConfig) {
  return post<T>({
    url: '/setting-mail',
    data: mail,
  })
}

export function fetchTestMail<T = any>(mail: MailConfig) {
  return post<T>({
    url: '/mail-test',
    data: mail,
  })
}

export function fetchUpdateSite<T = any>(config: SiteConfig) {
  return post<T>({
    url: '/setting-site',
    data: config,
  })
}

export function fetchUpdateBaseSetting<T = any>(config: ConfigState) {
  return post<T>({
    url: '/setting-base',
    data: config,
  })
}

export function fetchUserStatistics<T = any>(userid: string, start: number, end: number) {
  return post<T>({
    url: '/statistics/by-day',
    data: { userid, start, end },
  })
}

export function fetchGetKeys<T = any>(page: number, size: number) {
  return get<T>({
    url: '/setting-keys',
    data: { page, size },
  })
}

export function fetchUpdateApiKeyStatus<T = any>(id: string, status: Status) {
  return post<T>({
    url: '/setting-key-status',
    data: { id, status },
  })
}

export function fetchUpsertApiKey<T = any>(keyConfig: KeyConfig) {
  return post<T>({
    url: '/setting-key-upsert',
    data: keyConfig,
  })
}

export function fetchPluginList<T = any>() {
  return get<T>({
    url: '/plugin/list',
  })
}

export function fetchPluginModels<T = any>() {
  return get<T>({
    url: '/plugin/models',
  })
}

export function fetchRefreshPlugins<T = any>() {
  return post<T>({
    url: '/plugin/refresh',
  })
}

export function fetchUpdatePluginEnabled<T = any>(id: string, enabled: boolean) {
  return post<T>({
    url: '/plugin/enabled',
    data: { id, enabled },
  })
}

export function fetchPublishPlugin<T = any>(id: string, published: boolean) {
  return post<T>({
    url: '/plugin/publish',
    data: { id, published },
  })
}

export function fetchUpdatePluginSettings<T = any>(id: string, settings: Record<string, any>) {
  return post<T>({
    url: '/plugin/settings',
    data: { id, settings },
  })
}
