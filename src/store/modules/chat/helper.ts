import localforage from 'localforage'

const LOCAL_NAME = 'chatStorage'

export function defaultState(): Chat.ChatState {
  const uuid = 1002
  return {
    active: uuid,
    usingContext: true,
    history: [{ uuid, title: 'New Chat', titleSource: 'placeholder', isEdit: false, usingContext: true, usingDraw: false, chatModel: 'gpt-3.5-turbo' }],
    chat: [{ uuid, data: [] }],
  }
}

export async function getLocalState(): Promise<Chat.ChatState> {
  const localState = await localforage.getItem<Chat.ChatState>(LOCAL_NAME)
  return { ...defaultState(), ...(localState || {}) }
}

export function setLocalState(state: Chat.ChatState) {
  // 必须将 Vue Proxy 转换为普通对象，否则 IndexedDB 无法使用结构化克隆算法
  localforage.setItem(LOCAL_NAME, JSON.parse(JSON.stringify(state)))
}
