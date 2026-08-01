import { defineStore } from 'pinia'
import { defaultState, getLocalState, setLocalState } from './helper'
import { router } from '@/router'
import { getDefaultChatModel } from '@/utils/chatModel'
import { fetchClearChat, fetchCreateChatRoom, fetchDeleteChat, fetchDeleteChatRoom, fetchGetChatHistory, fetchGetChatRooms, fetchRenameChatRoom, fetchUpdateChatRoomChatModel, fetchUpdateChatRoomUsingContext, fetchUpdateChatRoomUsingDraw } from '@/api'

export const useChatStore = defineStore('chat-store', {
  state: (): Chat.ChatState => defaultState(),

  getters: {
    getChatHistoryByCurrentActive(state: Chat.ChatState) {
      const index = state.history.findIndex(item => item.uuid === state.active)
      if (index !== -1)
        return state.history[index]
      return null
    },

    getChatByUuid(state: Chat.ChatState) {
      return (uuid?: number) => {
        if (uuid)
          return state.chat.find(item => item.uuid === uuid)?.data ?? []
        return state.chat.find(item => item.uuid === state.active)?.data ?? []
      }
    },
  },

  actions: {
    async initStore() {
      const state = await getLocalState()
      this.$patch(state)
    },

    async syncHistory(callback?: () => void) {
      const rooms = (await fetchGetChatRooms()).data
      let uuid = this.active
      this.history = []
      this.chat = []
      if (rooms.findIndex((item: { uuid: number | null }) => item.uuid === uuid) <= -1)
        uuid = null

      for (const r of rooms) {
        this.history.unshift(r)
        if (uuid == null)
          uuid = r.uuid
        this.chat.unshift({ uuid: r.uuid, data: [] })
      }
      if (uuid == null) {
        await this.addHistory({ title: 'New Chat', titleSource: 'placeholder', uuid: Date.now(), isEdit: false, usingContext: true, usingDraw: false, chatModel: getDefaultChatModel() })
      }
      else {
        this.active = uuid
        this.reloadRoute(uuid)
      }
      callback && callback()
    },

    async syncChat(h: Chat.History, lastId?: number, callback?: () => void,
      callbackForStartRequest?: () => void,
      callbackForEmptyMessage?: () => void) {
      if (!h.uuid) {
        callback && callback()
        return
      }
      let historyIndex = this.history.findIndex(item => item.uuid === h.uuid)
      if (historyIndex === -1 || this.history[historyIndex].loading || this.history[historyIndex].all) {
        if (lastId === undefined) {
          // 加载更多不回调 避免加载概率消失
          callback && callback()
        }
        if (historyIndex !== -1 && this.history[historyIndex].all)
          callbackForEmptyMessage && callbackForEmptyMessage()
        return
      }
      try {
        this.history[historyIndex].loading = true
        let chatIndex = this.chat.findIndex(item => item.uuid === h.uuid)
        if (chatIndex <= -1 || this.chat[chatIndex].data.length <= 0 || lastId !== undefined) {
          callbackForStartRequest && callbackForStartRequest()
          const chatData = (await fetchGetChatHistory(h.uuid, lastId)).data
          historyIndex = this.history.findIndex(item => item.uuid === h.uuid)
          if (historyIndex === -1)
            return

          if (chatData.length <= 0)
            this.history[historyIndex].all = true

          chatIndex = this.chat.findIndex(item => item.uuid === h.uuid)
          if (chatIndex <= -1)
            this.chat.unshift({ uuid: h.uuid, data: chatData })
          else
            this.chat[chatIndex].data.unshift(...chatData)
        }
      }
      finally {
        historyIndex = this.history.findIndex(item => item.uuid === h.uuid)
        if (historyIndex !== -1)
          this.history[historyIndex].loading = false

        if (historyIndex !== -1 && this.history[historyIndex].all)
          callbackForEmptyMessage && callbackForEmptyMessage()
        this.recordState()
        callback && callback()
      }
    },

    async  setUsingContext(context: boolean, roomId: number) {
      await fetchUpdateChatRoomUsingContext(context, roomId)
      this.recordState()
    },

    async setUsingDraw(using: boolean, roomId: number) {
      await fetchUpdateChatRoomUsingDraw(using, roomId)
      const index = this.history.findIndex(item => item.uuid === roomId)
      if (index !== -1) {
        this.history[index].usingDraw = using
        this.recordState()
      }
    },

    async setChatModel(model: string, roomId: number) {
      await fetchUpdateChatRoomChatModel(model, roomId)
      this.recordState()
    },

    async addHistory(history: Chat.History, chatData: Chat.Chat[] = []) {
      await fetchCreateChatRoom(history.title, history.chatModel, history.uuid)
      this.history.unshift(history)
      this.chat.unshift({ uuid: history.uuid, data: chatData })
      this.active = history.uuid
      this.reloadRoute(history.uuid)
    },

    async updateHistory(uuid: number, edit: Partial<Chat.History>) {
      const index = this.history.findIndex(item => item.uuid === uuid)
      if (index === -1)
        return

      if (edit.isEdit === false) {
        const history = this.history[index]
        const { data } = await fetchRenameChatRoom<{ title: string; titleSource: Chat.History['titleSource'] }>(history.title, history.uuid)
        const currentIndex = this.history.findIndex(item => item.uuid === uuid)
        if (currentIndex === -1)
          return
        this.history[currentIndex] = {
          ...this.history[currentIndex],
          title: data.title,
          titleSource: data.titleSource,
          isEdit: false,
        }
        this.recordState()
        return
      }

      this.history[index] = { ...this.history[index], ...edit }
      this.recordState()
    },

    applyAutomaticTitle(uuid: number, title: string, titleSource: Chat.History['titleSource']) {
      const index = this.history.findIndex(item => item.uuid === uuid)
      if (index === -1 || this.history[index].isEdit || this.history[index].titleSource === 'manual')
        return
      this.history[index].title = title
      this.history[index].titleSource = titleSource
      this.recordState()
    },

    async deleteHistory(index: number) {
      const targetUuid = this.history[index].uuid
      await fetchDeleteChatRoom(targetUuid)
      
      const currentIndex = this.history.findIndex(item => item.uuid === targetUuid)
      if (currentIndex !== -1) {
        this.history.splice(currentIndex, 1)
        this.chat.splice(currentIndex, 1)
      }

      if (this.history.length === 0) {
        await this.addHistory({ title: 'New Chat', titleSource: 'placeholder', chatModel: getDefaultChatModel(), uuid: Date.now(), isEdit: false, usingContext: true, usingDraw: false })
        return
      }

      if (currentIndex > 0 && currentIndex <= this.history.length) {
        const uuid = this.history[currentIndex - 1].uuid
        this.active = uuid
        this.reloadRoute(uuid)
        return
      }

      if (currentIndex === 0) {
        if (this.history.length > 0) {
          const uuid = this.history[0].uuid
          this.active = uuid
          this.reloadRoute(uuid)
        }
      }

      if (currentIndex > this.history.length) {
        const uuid = this.history[this.history.length - 1].uuid
        this.active = uuid
        this.reloadRoute(uuid)
      }
    },

    async setActive(uuid: number) {
      this.active = uuid
      return await this.reloadRoute(uuid)
    },

    getChatByUuidAndIndex(uuid: number, index: number) {
      if (!uuid || uuid === 0) {
        if (this.chat.length)
          return this.chat[0].data[index]
        return null
      }
      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1)
        return this.chat[chatIndex].data[index]
      return null
    },

    addChatByUuid(uuid: number, chat: Chat.Chat) {
      if (!uuid || uuid === 0) {
        if (this.history.length === 0) {
          const uuid = Date.now()
          const chatModel = getDefaultChatModel()
          fetchCreateChatRoom('New Chat', chatModel, uuid)
          this.history.unshift({ uuid, title: 'New Chat', titleSource: 'placeholder', isEdit: false, usingContext: true, usingDraw: false, chatModel })
          this.chat.unshift({ uuid, data: [chat] })
          this.active = uuid
          this.recordState()
        }
        else {
          this.chat[0].data.push(chat)
          this.recordState()
        }
      }

      const index = this.chat.findIndex(item => item.uuid === uuid)
      if (index !== -1) {
        this.chat[index].data.push(chat)
        this.recordState()
      }
    },

    updateChatByUuid(uuid: number, index: number, chat: Chat.Chat) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          chat.uuid = this.chat[0].data[index].uuid
          this.chat[0].data[index] = chat
          this.recordState()
        }
        return
      }

      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1) {
        chat.uuid = this.chat[chatIndex].data[index].uuid
        this.chat[chatIndex].data[index] = chat
        this.recordState()
      }
    },

    updateChatSomeByUuid(uuid: number, index: number, chat: Partial<Chat.Chat>) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          chat.uuid = this.chat[0].data[index].uuid
          this.chat[0].data[index] = { ...this.chat[0].data[index], ...chat }
          this.recordState()
        }
        return
      }

      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1) {
        chat.uuid = this.chat[chatIndex].data[index].uuid
        this.chat[chatIndex].data[index] = { ...this.chat[chatIndex].data[index], ...chat }
        this.recordState()
      }
    },

    deleteChatByUuid(uuid: number, index: number) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          fetchDeleteChat(uuid, this.chat[0].data[index].uuid || 0, this.chat[0].data[index].inversion)
          this.chat[0].data.splice(index, 1)
          this.recordState()
        }
        return
      }

      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1) {
        fetchDeleteChat(uuid, this.chat[chatIndex].data[index].uuid || 0, this.chat[chatIndex].data[index].inversion)
        this.chat[chatIndex].data.splice(index, 1)
        this.recordState()
      }
    },

    clearChatByUuid(uuid: number) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          fetchClearChat(this.chat[0].uuid)
          this.chat[0].data = []
          this.recordState()
        }
        return
      }

      const index = this.chat.findIndex(item => item.uuid === uuid)
      if (index !== -1) {
        fetchClearChat(uuid)
        this.chat[index].data = []
        this.recordState()
      }
    },

    async clearLocalChat() {
      this.chat = []
      this.history = []
      this.active = null
      this.recordState()
      await router.push({ name: 'Chat' })
    },

    async reloadRoute(uuid?: number) {
      this.recordState()
      await router.push({ name: 'Chat', params: { uuid } })
    },

    recordState() {
      setLocalState(this.$state)
    },
  },
})
