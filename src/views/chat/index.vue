<script setup lang='ts'>
import type { Ref } from 'vue'
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import type { MessageReactive } from 'naive-ui'
import { NAutoComplete, NDropdown, NInput, NSelect, NSpin, useDialog, useMessage } from 'naive-ui'
import html2canvas from 'html2canvas'
import { Message } from './components'
import { useScroll } from './hooks/useScroll'
import { useChat } from './hooks/useChat'
import HeaderComponent from './components/Header/index.vue'
import { HoverButton, SvgIcon } from '@/components/common'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { useIconRender } from '@/hooks/useIconRender'
import { useAppStore, useAuthStore, useChatStore, usePromptStore } from '@/store'
import { fetchChatAPIProcess, fetchChatResponseoHistory, fetchChatStopResponding, fetchGenerateChatRoomTitle, fetchUploadImages } from '@/api'
import { createController, abortController, hasController } from '@/utils/abortController'
import { getDefaultChatModel } from '@/utils/chatModel'
import { t } from '@/locales'
import { debounce } from '@/utils/functions/debounce'
const Prompt = defineAsyncComponent(() => import('@/components/common/Setting/Prompt.vue'))

const openLongReply = import.meta.env.VITE_GLOB_OPEN_LONG_REPLY === 'true'

const route = useRoute()
const dialog = useDialog()
const ms = useMessage()
const appStore = useAppStore()
const authStore = useAuthStore()
const chatStore = useChatStore()

const { isMobile } = useBasicLayout()
const { iconRender } = useIconRender()
const { addChat, updateChat, updateChatSome, getChatByUuidAndIndex } = useChat()
const { scrollRef, scrollToBottom, scrollToBottomIfAtBottom, scrollTo } = useScroll()

const { uuid } = route.params as { uuid: string }

const currentChatHistory = computed(() => chatStore.getChatHistoryByCurrentActive)
const usingContext = computed(() => !!(currentChatHistory?.value?.usingContext ?? true))
const currentChatModel = computed(() => currentChatHistory?.value?.chatModel ?? getDefaultChatModel())
const usingDraw = computed(() => currentChatHistory?.value?.usingDraw ?? false)
const dataSources = computed(() => chatStore.getChatByUuid(+uuid))
const conversationList = computed(() => dataSources.value.filter(item => (!item.inversion && !!item.conversationOptions)))

const prompt = ref<string>('')
const firstLoading = ref<boolean>(false)
const loading = computed(() => !!(currentChatHistory.value?.loading))
const inputRef = ref<Ref | null>(null)
const showPrompt = ref(false)
// 图片附件：上传后得到的可访问URL列表
const attachedImageUrls = ref<string[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)

let loadingms: MessageReactive
let prevScrollTop: number

// 添加PromptStore
const promptStore = usePromptStore()

// 使用storeToRefs，保证store修改后，联想部分能够重新渲染
const { promptList: promptTemplate } = storeToRefs<any>(promptStore)

// 刷新页面导致孤儿 loading 状态清理；有活跃控制器的会话跳过
const activeHistory = chatStore.getChatHistoryByCurrentActive
if (!activeHistory?.loading || !hasController(+uuid)) {
  if (activeHistory?.loading)
    chatStore.updateHistory(+uuid, { loading: false })
  dataSources.value.forEach((item, index) => {
    if (item.loading)
      updateChatSome(+uuid, index, { loading: false })
  })
}

function toAbsolute(u: string): string {
  return (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) ? u : new URL(u, window.location.origin).toString()
}

function handleSubmit() {
  onConversation()
}

function triggerAttach() {
  if (!fileInputRef.value) return
  fileInputRef.value.value = ''
  fileInputRef.value.click()
}

function removeAttachedImage(index: number) {
  attachedImageUrls.value = attachedImageUrls.value.filter((_, i) => i !== index)
}

async function onFilesSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  const form = new FormData()
  Array.from(files).forEach(f => form.append('files', f))
  try {
    const res = await fetchUploadImages<{ urls: string[] }>(form)
    const urls = (res as any)?.data?.urls || []
    attachedImageUrls.value = [...attachedImageUrls.value, ...urls]
    ms.success(`已添加图片 ${urls.length} 张`)
  }
  catch (err: any) {
    ms.error(err?.message || '图片上传失败')
  }
}

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'file') {
      const f = it.getAsFile()
      if (f && f.type.startsWith('image/')) files.push(f)
    }
  }
  if (files.length === 0) return
  const form = new FormData()
  files.forEach(f => form.append('files', f))
  try {
    const res = await fetchUploadImages<{ urls: string[] }>(form)
    const urls = (res as any)?.data?.urls || []
    attachedImageUrls.value = [...attachedImageUrls.value, ...urls]
    ms.success(`已粘贴图片 ${urls.length} 张`)
  }
  catch (err: any) {
    ms.error(err?.message || '图片上传失败')
  }
}

function requestAutomaticRoomTitle(userMessage: string, assistantMessage: string) {
  if (!assistantMessage)
    return

  fetchGenerateChatRoomTitle(+uuid, userMessage, assistantMessage)
    .then(({ data }) => chatStore.applyAutomaticTitle(+uuid, data.title, data.titleSource))
    .catch(() => {})
}

async function onConversation() {
  let message = prompt.value

  if (loading.value)
    return

  if (!message || message.trim() === '')
    return

  // 复制当前待发送的附件，并立即清空预览以避免粘贴后发送时预览残留
  const imagesToSend = attachedImageUrls.value.length > 0 ? [...attachedImageUrls.value] : []
  if (imagesToSend.length > 0)
    attachedImageUrls.value = []

  const ctrl = createController(+uuid)

  const chatUuid = Date.now()
  const attachmentsMarkdown = imagesToSend.length > 0 ? imagesToSend.map(u => `![image](${toAbsolute(u)})`).join('\n') : ''
  const userText = attachmentsMarkdown ? `${message}\n\n${attachmentsMarkdown}` : message
  addChat(
    +uuid,
    {
      uuid: chatUuid,
      dateTime: Date.now(),
      text: userText,
      inversion: true,
      error: false,
      conversationOptions: null,
      requestOptions: { prompt: message, options: null, images: imagesToSend.length > 0 ? imagesToSend : undefined },
    },
  )
  scrollToBottom()

  chatStore.updateHistory(+uuid, { loading: true })
  prompt.value = ''

  let options: Chat.ConversationRequest = {}
  const lastContext = conversationList.value[conversationList.value.length - 1]?.conversationOptions
  const extractImageUrls = (s: string) => {
    const result: string[] = []
    const md = [...String(s || '').matchAll(/\!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1])
    const html = [...String(s || '').matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1])
    md.forEach(u => result.push(u))
    html.forEach(u => result.push(u))
    return Array.from(new Set(result))
  }
  const findLastAssistantImages = () => {
    for (let i = dataSources.value.length - 1; i >= 0; i--) {
      const item = dataSources.value[i]
      if (!item.inversion && item.text) {
        const urls = extractImageUrls(item.text)
        if (urls.length > 0) return urls
      }
    }
    return []
  }
  const findNearestUserImages = () => {
    for (let i = dataSources.value.length - 1; i >= 0; i--) {
      const item = dataSources.value[i]
      const imgs = (item?.requestOptions as any)?.images || []
      if (imgs.length > 0) return imgs
    }
    return []
  }
  let clearTextContextForAssistantImage = false
  // 仅在 usingContext=true 时才进行历史图片回溯；usingContext=false 完全输入驱动，不做图片回填
  if (usingContext.value && imagesToSend.length === 0) {
    const assistantImages = findLastAssistantImages()
    if (assistantImages.length > 0) {
      imagesToSend.push(...assistantImages)
      clearTextContextForAssistantImage = true
    }
    else {
      const nearestUserImages = findNearestUserImages()
      if (nearestUserImages.length > 0)
        imagesToSend.push(...nearestUserImages)
    }
  }

  if (lastContext && usingContext.value)
    options = clearTextContextForAssistantImage ? {} : { ...lastContext }

  addChat(
    +uuid,
    {
      uuid: chatUuid,
      dateTime: Date.now(),
      text: '',
      loading: true,
      inversion: false,
      error: false,
      thinking: '',
      thinkingExpanded: false,
      conversationOptions: null,
      requestOptions: { prompt: message, options: { ...options }, images: imagesToSend.length > 0 ? imagesToSend : undefined },
    },
  )
  scrollToBottom()

  try {
    let lastThinking = ''
    const fetchChatAPIOnce = async () => {
      let streamBuffer = ''
      let parsedLength = 0
      const stripImageFromMarkdown = (s: string) => String(s || '')
        .replace(/\!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/<img[^>]*>/gi, '')
        .trim()
      const applyStreamChunk = (data: any) => {
        const usage: Chat.Chat['usage'] | undefined = (data.detail && data.detail.usage)
          ? {
              completion_tokens: Number(data.detail.usage.completion_tokens ?? 0),
              prompt_tokens: Number(data.detail.usage.prompt_tokens ?? 0),
              total_tokens: Number(data.detail.usage.total_tokens ?? 0),
              estimated: Boolean(data.detail.usage.estimated),
            }
          : undefined
        const thinkingPart = (data.thinking ?? (data.detail && (data.detail.thinking ?? undefined)))
        if (typeof thinkingPart === 'string')
          lastThinking += thinkingPart
        updateChat(
          +uuid,
          dataSources.value.length - 1,
          {
            dateTime: Date.now(),
            text: data.text ?? '',
            inversion: false,
            error: false,
            loading: true,
            thinking: lastThinking,
            thinkingExpanded: false,
            toolStatus: data.toolStatus,
            conversationOptions: { conversationId: data.conversationId, parentMessageId: data.id },
            requestOptions: { prompt: message, options: { ...options }, images: imagesToSend.length > 0 ? imagesToSend : undefined },
            usage,
          },
        )

        scrollToBottomIfAtBottom()
      }
      await fetchChatAPIProcess<Chat.ConversationResponse>({
        roomId: +uuid,
        uuid: chatUuid,
        prompt: imagesToSend.length > 0 ? stripImageFromMarkdown(message) : message,
        images: imagesToSend.length > 0 ? imagesToSend : undefined,
        options,
        draw: appStore.advancedMode ? usingDraw.value : false,
        autoContinue: openLongReply,
        signal: ctrl.signal,
        onDownloadProgress: ({ event }) => {
          const xhr = event.target
          const { responseText } = xhr
          const incoming = responseText.slice(parsedLength)
          parsedLength = responseText.length
          streamBuffer += incoming
          const lines = streamBuffer.split('\n')
          streamBuffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim())
              continue
            try {
              const data = JSON.parse(line)
              applyStreamChunk(data)
            }
            catch (error) {
              //
            }
          }
        },
      })
      if (streamBuffer.trim()) {
        try {
          const data = JSON.parse(streamBuffer)
          streamBuffer = ''
          applyStreamChunk(data)
        }
        catch (error) {
          //
        }
      }
      updateChatSome(+uuid, dataSources.value.length - 1, { loading: false, thinkingExpanded: false, toolStatus: undefined })
    }

    await fetchChatAPIOnce()
    const assistantMessage = getChatByUuidAndIndex(+uuid, dataSources.value.length - 1)?.text || ''
    requestAutomaticRoomTitle(message, assistantMessage)
  }
  catch (error: any) {
    const errorMessage = error?.message ?? t('common.wrong')

    if (error.message === 'canceled') {
      updateChatSome(
        +uuid,
        dataSources.value.length - 1,
        {
          loading: false,
        },
      )
      scrollToBottomIfAtBottom()
      return
    }

    const currentChat = getChatByUuidAndIndex(+uuid, dataSources.value.length - 1)

    if (currentChat?.text && currentChat.text !== '') {
      updateChatSome(
        +uuid,
        dataSources.value.length - 1,
        {
          text: `${currentChat.text}\n[${errorMessage}]`,
          error: false,
          loading: false,
        },
      )
      return
    }

    updateChat(
      +uuid,
      dataSources.value.length - 1,
      {
        dateTime: Date.now(),
        text: errorMessage,
        inversion: false,
        error: true,
        loading: false,
        thinkingExpanded: false,
        conversationOptions: null,
        requestOptions: { prompt: message, options: { ...options } },
      },
    )
    scrollToBottomIfAtBottom()
  }
  finally {
    chatStore.updateHistory(+uuid, { loading: false })
  }
}

async function onRegenerate(index: number) {
  if (loading.value)
    return

  const ctrl = createController(+uuid)

  const { requestOptions } = dataSources.value[index]
  let responseCount = dataSources.value[index].responseCount || 1
  responseCount++

  let message = requestOptions?.prompt ?? ''

  let options: Chat.ConversationRequest = {}

  if (requestOptions.options)
    options = { ...requestOptions.options }

  chatStore.updateHistory(+uuid, { loading: true })
  const chatUuid = dataSources.value[index].uuid
  updateChat(
    +uuid,
    index,
    {
      dateTime: Date.now(),
      text: '',
      inversion: false,
      responseCount,
      error: false,
      loading: true,
      thinking: '',
      thinkingExpanded: false,
      conversationOptions: null,
      requestOptions: { prompt: message, options: { ...options } },
    },
  )

  try {
    let lastThinking = ''
    const fetchChatAPIOnce = async () => {
      let streamBuffer = ''
      let parsedLength = 0
      const originalImages: string[] = (dataSources.value[index]?.requestOptions as any)?.images || []
      const stripImageFromMarkdown = (s: string) => String(s || '')
        .replace(/\!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/<img[^>]*>/gi, '')
        .trim()
      const applyStreamChunk = (data: any) => {
        const usage: Chat.Chat['usage'] | undefined = (data.detail && data.detail.usage)
          ? {
              completion_tokens: Number(data.detail.usage.completion_tokens ?? 0),
              prompt_tokens: Number(data.detail.usage.prompt_tokens ?? 0),
              total_tokens: Number(data.detail.usage.total_tokens ?? 0),
              estimated: Boolean(data.detail.usage.estimated),
            }
          : undefined
        const thinkingPart = (data.thinking ?? (data.detail && (data.detail.thinking ?? undefined)))
        if (typeof thinkingPart === 'string')
          lastThinking += thinkingPart
        updateChat(
          +uuid,
          index,
          {
            dateTime: Date.now(),
            text: data.text ?? '',
            inversion: false,
            responseCount,
            error: false,
            loading: true,
            thinking: lastThinking,
            thinkingExpanded: false,
            toolStatus: data.toolStatus,
            conversationOptions: { conversationId: data.conversationId, parentMessageId: data.id },
            requestOptions: { prompt: message, options: { ...options }, images: originalImages.length > 0 ? originalImages : undefined },
            usage,
          },
        )

      }
      await fetchChatAPIProcess<Chat.ConversationResponse>({
        roomId: +uuid,
        uuid: chatUuid || Date.now(),
        regenerate: true,
        prompt: originalImages.length > 0 ? stripImageFromMarkdown(message) : message,
        images: originalImages.length > 0 ? originalImages : undefined,
        options,
        draw: appStore.advancedMode ? usingDraw.value : false,
        autoContinue: openLongReply,
        signal: ctrl.signal,
        onDownloadProgress: ({ event }) => {
          const xhr = event.target
          const { responseText } = xhr
          const incoming = responseText.slice(parsedLength)
          parsedLength = responseText.length
          streamBuffer += incoming
          const lines = streamBuffer.split('\n')
          streamBuffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim())
              continue
            try {
              const data = JSON.parse(line)
              applyStreamChunk(data)
            }
            catch (error) {
              //
            }
          }
        },
      })
      if (streamBuffer.trim()) {
        try {
          const data = JSON.parse(streamBuffer)
          streamBuffer = ''
          applyStreamChunk(data)
        }
        catch (error) {
          //
        }
      }
      updateChatSome(+uuid, index, { loading: false, thinkingExpanded: false, toolStatus: undefined })
    }
    await fetchChatAPIOnce()
    const assistantMessage = getChatByUuidAndIndex(+uuid, index)?.text || ''
    requestAutomaticRoomTitle(message, assistantMessage)
  }
  catch (error: any) {
    if (error.message === 'canceled') {
      updateChatSome(
        +uuid,
        index,
        {
          loading: false,
        },
      )
      return
    }

    const errorMessage = error?.message ?? t('common.wrong')

    updateChat(
      +uuid,
      index,
      {
        dateTime: Date.now(),
        text: errorMessage,
        inversion: false,
        responseCount,
        error: true,
        loading: false,
        conversationOptions: null,
        requestOptions: { prompt: message, options: { ...options } },
      },
    )
  }
  finally {
    chatStore.updateHistory(+uuid, { loading: false })
  }
}

async function onResponseHistory(index: number, historyIndex: number) {
  const chat = (await fetchChatResponseoHistory(+uuid, dataSources.value[index].uuid || Date.now(), historyIndex)).data
  updateChat(
    +uuid,
    index,
    {
      dateTime: chat.dateTime,
      text: chat.text,
      inversion: false,
      responseCount: chat.responseCount,
      error: chat.error ?? false,
      loading: false,
      thinking: chat.thinking || '',
      thinkingExpanded: false,
      conversationOptions: chat.conversationOptions,
      requestOptions: {
        prompt: chat.requestOptions.prompt,
        options: { ...chat.requestOptions.options },
        images: (chat.requestOptions as any)?.images || undefined,
      },
      usage: chat.usage,
    },
  )
}

function handleExport() {
  if (loading.value)
    return

  const d = dialog.warning({
    title: t('chat.exportImage'),
    content: t('chat.exportImageConfirm'),
    positiveText: t('common.yes'),
    negativeText: t('common.no'),
    onPositiveClick: async () => {
      try {
        d.loading = true
        const ele = document.getElementById('image-wrapper')
        const canvas = await html2canvas(ele as HTMLDivElement, {
          useCORS: true,
        })
        const imgUrl = canvas.toDataURL('image/png')
        const tempLink = document.createElement('a')
        tempLink.style.display = 'none'
        tempLink.href = imgUrl
        tempLink.setAttribute('download', 'chat-shot.png')
        if (typeof tempLink.download === 'undefined')
          tempLink.setAttribute('target', '_blank')

        document.body.appendChild(tempLink)
        tempLink.click()
        document.body.removeChild(tempLink)
        window.URL.revokeObjectURL(imgUrl)
        d.loading = false
        ms.success(t('chat.exportSuccess'))
        Promise.resolve()
      }
      catch (error: any) {
        ms.error(t('chat.exportFailed'))
      }
      finally {
        d.loading = false
      }
    },
  })
}

function handleDelete(index: number) {
  if (loading.value)
    return

  dialog.warning({
    title: t('chat.deleteMessage'),
    content: t('chat.deleteMessageConfirm'),
    positiveText: t('common.yes'),
    negativeText: t('common.no'),
    onPositiveClick: () => {
      chatStore.deleteChatByUuid(+uuid, index)
    },
  })
}

function handleClear() {
  if (loading.value)
    return

  dialog.warning({
    title: t('chat.clearChat'),
    content: t('chat.clearChatConfirm'),
    positiveText: t('common.yes'),
    negativeText: t('common.no'),
    onPositiveClick: () => {
      chatStore.clearChatByUuid(+uuid)
    },
  })
}

function handleEnter(event: KeyboardEvent) {
  if (!isMobile.value) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }
  else {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      handleSubmit()
    }
  }
}

async function handleStop() {
  if (loading.value) {
    abortController(+uuid)
    chatStore.updateHistory(+uuid, { loading: false })
    const lastMsg = dataSources.value[dataSources.value.length - 1]
    if (lastMsg && !lastMsg.inversion) {
      await fetchChatStopResponding(
        lastMsg.text,
        lastMsg.conversationOptions?.parentMessageId ?? '',
        lastMsg.conversationOptions?.conversationId ?? '',
        lastMsg.uuid,
      )
    }
  }
}

async function loadMoreMessage(event: any) {
  const chatIndex = chatStore.chat.findIndex(d => d.uuid === +uuid)
  if (chatIndex <= -1 || chatStore.chat[chatIndex].data.length <= 0)
    return

  const scrollPosition = event.target.scrollHeight - event.target.scrollTop

  const lastId = chatStore.chat[chatIndex].data[0].uuid
  await chatStore.syncChat({ uuid: +uuid } as Chat.History, lastId, () => {
    loadingms && loadingms.destroy()
    nextTick(() => scrollTo(event.target.scrollHeight - scrollPosition))
  }, () => {
    loadingms = ms.loading(
      '加载中...', {
        duration: 0,
      },
    )
  }, () => {
    // 移除“没有更多了”的提示，不做任何操作
  })
}

const handleLoadMoreMessage = debounce(loadMoreMessage, 300)
const handleSyncChat
  = debounce(() => {
    // 直接刷 极小概率不请求
    chatStore.syncChat({ uuid: Number(uuid) } as Chat.History, undefined, () => {
      firstLoading.value = false
      const scrollRef = document.querySelector('#scrollRef')
      if (scrollRef)
        nextTick(() => scrollRef.scrollTop = scrollRef.scrollHeight)
      if (inputRef.value && !isMobile.value)
        inputRef.value?.focus()
    })
  }, 200)

async function handleScroll(event: any) {
  const scrollTop = event.target.scrollTop
  if (scrollTop < 50 && (scrollTop < prevScrollTop || prevScrollTop === undefined))
    handleLoadMoreMessage(event)
  prevScrollTop = scrollTop
}

async function handleToggleUsingContext() {
  if (!currentChatHistory.value)
    return

  if (usingDraw.value) {
    ms.warning(t('chat.contextDisabledByDraw'))
    return
  }

  currentChatHistory.value.usingContext = !currentChatHistory.value.usingContext
  chatStore.setUsingContext(currentChatHistory.value.usingContext, +uuid)
  if (currentChatHistory.value.usingContext)
    ms.success(t('chat.turnOnContext'))
  else
    ms.warning(t('chat.turnOffContext'))
}

async function handleToggleUsingDraw() {
  if (!currentChatHistory.value)
    return

  const newValue = !currentChatHistory.value.usingDraw
  currentChatHistory.value.usingDraw = newValue
  await chatStore.setUsingDraw(newValue, +uuid)

  if (newValue) {
    if (currentChatHistory.value.usingContext) {
      currentChatHistory.value.usingContext = false
      await chatStore.setUsingContext(false, +uuid)
      ms.warning(t('chat.turnOffContextBecauseDraw'))
    }
    else {
      ms.success(t('chat.turnOnDraw'))
    }
  }
  else {
    ms.warning(t('chat.turnOffDraw'))
  }
}

// 可优化部分
// 搜索选项计算，这里使用value作为索引项，所以当出现重复value时渲染异常(多项同时出现选中效果)
// 理想状态下其实应该是key作为索引项,但官方的renderOption会出现问题，所以就需要value反renderLabel实现
const searchOptions = computed(() => {
  if (prompt.value.startsWith('/')) {
    return promptTemplate.value.filter((item: { key: string }) => item.key.toLowerCase().includes(prompt.value.substring(1).toLowerCase())).map((obj: { value: any }) => {
      return {
        label: obj.value,
        value: obj.value,
      }
    })
  }
  else {
    return []
  }
})

// value反渲染key
const renderOption = (option: { label: string }) => {
  for (const i of promptTemplate.value) {
    if (i.value === option.label)
      return [i.key]
  }
  return []
}

const placeholder = computed(() => {
  if (isMobile.value)
    return t('chat.placeholderMobile')
  return t('chat.placeholder')
})

const moreMenuOptions = computed(() => [
  {
    label: t('chat.clearChat'),
    key: 'clear',
    icon: iconRender({ icon: 'ri:delete-bin-line' }),
  },
  {
    label: t('chat.exportImage'),
    key: 'export',
    icon: iconRender({ icon: 'ri:download-2-line' }),
  },
  {
    label: t('chat.roomPrompt'),
    key: 'prompt',
    icon: iconRender({ icon: 'ri:quill-pen-line' }),
  },
])

function handleMoreSelect(key: string) {
  if (key === 'clear')
    handleClear()
  else if (key === 'export')
    handleExport()
  else if (key === 'prompt')
    showPrompt.value = true
}

const buttonDisabled = computed(() => {
  return loading.value || !prompt.value || prompt.value.trim() === ''
})

const footerClass = computed(() => {
  let classes = ['p-4']
  if (isMobile.value)
    classes = ['sticky', 'left-0', 'bottom-0', 'right-0', 'p-2', 'pr-3', 'overflow-hidden']
  return classes
})

async function handleSyncChatModel(chatModel: string) {
  if (!currentChatHistory.value)
    return

  currentChatHistory.value.chatModel = chatModel
  chatStore.setChatModel(currentChatHistory.value.chatModel, +uuid)
}

const autoDisablingDrawRooms = new Set<number>()

async function disableHiddenDrawMode() {
  const history = currentChatHistory.value
  if (appStore.advancedMode || !history?.usingDraw || autoDisablingDrawRooms.has(history.uuid))
    return

  autoDisablingDrawRooms.add(history.uuid)
  try {
    await chatStore.setUsingDraw(false, history.uuid)
  }
  catch (error: any) {
    ms.error(error?.message || '自动关闭绘图模式失败')
  }
  finally {
    autoDisablingDrawRooms.delete(history.uuid)
  }
}

onMounted(() => {
  firstLoading.value = true
  handleSyncChat()
})

// 当会话中的可选模型变更时，如果当前房间所选模型不在新列表中，自动切换到第一个可用模型
watch(
  () => authStore.session?.chatModels,
  (options) => {
    const list = (options || []).map((o: any) => o?.value ?? o?.key ?? o?.label)
    const cur = currentChatModel.value
    if (list.length && !list.includes(cur)) {
      const next = getDefaultChatModel()
      if (next)
        handleSyncChatModel(next)
    }
  },
  { immediate: true },
)

// 普通模式不展示绘图入口，因此关闭高级模式或切换会话时主动清理隐藏的绘图状态。
watch(
  [
    () => appStore.advancedMode,
    () => currentChatHistory.value?.uuid,
    () => currentChatHistory.value?.usingDraw,
  ],
  async () => {
    await disableHiddenDrawMode()
  },
  { immediate: true },
)

watch(() => chatStore.active, () => {
  handleSyncChat()
})

onUnmounted(() => {
  // 不再中止控制器，切换会话后后台继续流式传输
})
</script>

<template>
  <div class="flex flex-col w-full h-full">
    <HeaderComponent
      v-if="isMobile"
      :using-context="usingContext"
      :show-prompt="showPrompt"
      @export="handleExport" @toggle-using-context="handleToggleUsingContext"
      @toggle-show-prompt="showPrompt = true"
    />
    <main class="flex-1 overflow-hidden">
      <div id="scrollRef" ref="scrollRef" class="h-full overflow-hidden overflow-y-auto" @scroll="handleScroll">
        <div
          id="image-wrapper"
          class="w-full m-auto"
          :class="[isMobile ? 'p-2' : 'p-4']"
          :style="!isMobile ? { maxWidth: '892px' } : {}"
        >
          <NSpin :show="firstLoading">
            <template v-if="!dataSources.length">
              <div class="empty-hero">
                <div class="empty-hero-icon">
                  <SvgIcon icon="ri:bubble-chart-fill" class="text-4xl" />
                </div>
                <h2 class="empty-hero-title">开始对话吧</h2>
                <p class="empty-hero-subtitle">在下方输入框中输入消息，与 AI 开始交流</p>
              </div>
            </template>
            <template v-else>
              <div>
                <Message
                  v-for="(item, index) of dataSources"
                  :key="index"
                  :date-time="item.dateTime"
                  :text="item.text"
                  :inversion="item.inversion"
                  :thinking="item.thinking"
                  :thinking-expanded="item.thinkingExpanded"
                  :tool-status="item.toolStatus"
                  :response-count="item.responseCount"
                  :usage="item && item.usage || undefined"
                  :error="item.error"
                  :loading="item.loading"
                  @regenerate="onRegenerate(index)"
                  @delete="handleDelete(index)"
                  @response-history="(ev) => onResponseHistory(index, ev)"
                />
                <div class="sticky bottom-0 left-0 flex justify-center pb-2">
                  <button v-if="loading" class="stop-btn" @click="handleStop">
                    <SvgIcon icon="ri:stop-circle-line" class="text-base" />
                    <span>停止回复</span>
                  </button>
                </div>
              </div>
            </template>
          </NSpin>
        </div>
      </div>
    </main>
    <footer :class="footerClass">
      <div class="w-full m-auto" :style="!isMobile ? { maxWidth: '860px' } : {}">
        <div class="chat-input-card">
          <div class="chat-toolbar">
            <div class="chat-toolbar-left">
              <HoverButton v-if="!isMobile" @click="handleToggleUsingContext">
                <span class="text-lg" :class="{ 'toolbar-icon-active': usingContext, 'toolbar-icon': !usingContext && !usingDraw, 'toolbar-icon-disabled': usingDraw }">
                  <SvgIcon icon="ri:chat-history-line" />
                </span>
              </HoverButton>
              <HoverButton v-if="!isMobile && appStore.advancedMode" @click="handleToggleUsingDraw">
                <span class="text-lg" :class="{ 'toolbar-icon-active': usingDraw, 'toolbar-icon': !usingDraw }">
                  <SvgIcon icon="ri:image-line" />
                </span>
              </HoverButton>
              <HoverButton v-if="!isMobile" @click="triggerAttach">
                <span class="toolbar-icon">
                  <SvgIcon icon="ri:attachment-2" />
                </span>
              </HoverButton>
              <NDropdown
                v-if="!isMobile"
                trigger="hover"
                placement="top-start"
                :options="moreMenuOptions"
                @select="handleMoreSelect"
              >
                <HoverButton>
                  <span class="toolbar-icon">
                    <SvgIcon icon="ri:more-2-fill" />
                  </span>
                </HoverButton>
              </NDropdown>

              <!-- Mobile buttons -->
              <HoverButton v-if="isMobile" @click="handleClear">
                <span class="toolbar-icon">
                  <SvgIcon icon="ri:delete-bin-line" />
                </span>
              </HoverButton>
              <HoverButton v-if="isMobile && appStore.advancedMode" @click="handleToggleUsingDraw">
                <span class="text-lg" :class="{ 'toolbar-icon-active': usingDraw, 'toolbar-icon': !usingDraw }">
                  <SvgIcon icon="ri:image-line" />
                </span>
              </HoverButton>
              <HoverButton v-if="isMobile" @click="triggerAttach">
                <span class="toolbar-icon">
                  <SvgIcon icon="ri:attachment-2" />
                </span>
              </HoverButton>
            </div>

            <NSelect
              v-show="appStore.advancedMode"
              class="model-select"
              :value="currentChatModel"
              :options="authStore.session?.chatModels"
              :disabled="!!authStore.session?.auth && !authStore.token"
              @update-value="(val) => handleSyncChatModel(val)"
            />
          </div>

          <div v-if="attachedImageUrls.length > 0" class="chat-attachments">
            <div
              v-for="(u, index) in attachedImageUrls"
              :key="u"
              class="chat-attachment-item"
            >
              <img :src="u" class="chat-attachment-img" />
              <button
                v-if="!isMobile"
                type="button"
                class="chat-attachment-remove"
                @click="removeAttachedImage(index)"
              >
                <SvgIcon icon="ri:delete-bin-line" class="text-white text-sm" />
              </button>
              <button
                v-else
                type="button"
                class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center"
                @click="removeAttachedImage(index)"
              >
                <SvgIcon icon="ri:close-fill" class="text-white text-xs" />
              </button>
            </div>
          </div>

          <div class="chat-input-row">
            <NAutoComplete v-model:value="prompt" :options="searchOptions" :render-label="renderOption" class="flex-1">
              <template #default="{ handleInput, handleBlur, handleFocus }">
                <NInput
                  ref="inputRef"
                  v-model:value="prompt"
                  :disabled="!!authStore.session?.auth && !authStore.token"
                  type="textarea"
                  :placeholder="placeholder"
                  :autosize="{ minRows: isMobile ? 1 : 2, maxRows: isMobile ? 4 : 8 }"
                  @input="handleInput"
                  @focus="handleFocus"
                  @blur="handleBlur"
                  @keypress="handleEnter"
                  @paste="handlePaste"
                />
              </template>
            </NAutoComplete>
            <button class="send-btn" :disabled="buttonDisabled" @click="handleSubmit">
              <SvgIcon icon="ri:send-plane-fill" />
            </button>
          </div>
        </div>
      </div>
    </footer>
    <input ref="fileInputRef" type="file" style="position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; z-index: -1;" accept="image/*" multiple @change="onFilesSelected">
    <Prompt v-if="showPrompt" v-model:roomId="uuid" v-model:visible="showPrompt" />
  </div>
</template>

<style scoped>
/* Empty state hero */
.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 18vh;
  text-align: center;
  animation: fadeIn 0.4s ease-out;
}

.empty-hero-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--surface-bubble-ai);
  color: var(--text-secondary);
  margin-bottom: 20px;
}

.empty-hero-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.empty-hero-subtitle {
  font-size: 14px;
  color: var(--text-muted);
  max-width: 280px;
}

/* Stop button */
.stop-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--surface-chat);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  box-shadow: var(--shadow-sm);
}

.stop-btn:hover {
  background: var(--surface-hover);
  border-color: var(--text-muted);
}

/* Chat input card */
.chat-input-card {
  background: var(--surface-input);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-card);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.chat-input-card:focus-within {
  border-color: var(--text-muted);
  box-shadow: var(--shadow-md);
}

/* Toolbar */
.chat-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.chat-toolbar-left {
  display: flex;
  align-items: center;
  gap: 1px;
}

.toolbar-icon {
  font-size: 17px;
  color: var(--text-muted);
  transition: color var(--transition-fast);
}

.toolbar-icon-active {
  color: var(--brand-primary);
}

.toolbar-icon-disabled {
  color: var(--text-muted);
  opacity: 0.4;
}

.model-select {
  width: 200px;
  flex-shrink: 0;
}

/* Input row */
.chat-input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.chat-input-row :deep(.n-input) {
  background: transparent;
}

.chat-input-row :deep(.n-input .n-input__border),
.chat-input-row :deep(.n-input .n-input__state-border) {
  display: none !important;
}

/* Send button */
.send-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--brand-gradient);
  color: #fff;
  font-size: 17px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.send-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: scale(1.04);
}

.send-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Attachments */
.chat-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chat-attachment-item {
  position: relative;
  width: 60px;
  height: 60px;
}

.chat-attachment-img {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
}

.chat-attachment-remove {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  border-radius: var(--radius-sm);
  opacity: 0;
  transition: opacity var(--transition-fast);
  border: none;
  cursor: pointer;
}

.chat-attachment-remove:hover {
  opacity: 1;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
