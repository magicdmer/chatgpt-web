<script setup lang='ts'>
import type { Ref } from 'vue'
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import type { MessageReactive } from 'naive-ui'
import { NAutoComplete, NButton, NInput, NSelect, NSpace, NSpin, useDialog, useMessage } from 'naive-ui'
import html2canvas from 'html2canvas'
import { Message } from './components'
import { useScroll } from './hooks/useScroll'
import { useChat } from './hooks/useChat'
import HeaderComponent from './components/Header/index.vue'
import { HoverButton, SvgIcon } from '@/components/common'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { useAuthStore, useChatStore, usePromptStore } from '@/store'
import { fetchChatAPIProcess, fetchChatResponseoHistory, fetchChatStopResponding, fetchUploadImages, fetchImageEdit } from '@/api'
import { createController, abortController, hasController } from '@/utils/abortController'
import { buildExtraBody } from '@/utils/extraBody'
import { t } from '@/locales'
import { debounce } from '@/utils/functions/debounce'
import IconPrompt from '@/icons/Prompt.vue'
const Prompt = defineAsyncComponent(() => import('@/components/common/Setting/Prompt.vue'))

const openLongReply = import.meta.env.VITE_GLOB_OPEN_LONG_REPLY === 'true'

const route = useRoute()
const dialog = useDialog()
const ms = useMessage()
const authStore = useAuthStore()
const chatStore = useChatStore()

const { isMobile } = useBasicLayout()
const { addChat, updateChat, updateChatSome, getChatByUuidAndIndex } = useChat()
const { scrollRef, scrollToBottom, scrollToBottomIfAtBottom, scrollTo } = useScroll()

const { uuid } = route.params as { uuid: string }

const currentChatHistory = computed(() => chatStore.getChatHistoryByCurrentActive)
const usingContext = computed(() => !!(currentChatHistory?.value?.usingContext ?? true))
const currentChatModel = computed(() => currentChatHistory?.value?.chatModel ?? 'gpt-3.5-turbo')
const usingThinking = computed(() => currentChatHistory?.value?.usingThinking ?? false)
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
// 编辑模式（不使用蒙版，简化操作）
const isEditMode = ref<boolean>(false)
// 控制是否显示编辑按钮
const showEditButton = false

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

// 已移除蒙版上传逻辑

async function handleToggleUsingThinking() {
  if (!currentChatHistory.value)
    return
  const next = !usingThinking.value
  chatStore.setUsingThinking(next, +uuid)
  if (next)
    ms.success('已开启思考模式')
  else
    ms.warning('已关闭思考模式')
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
  let clearContextForEdit = false
  // 仅在 usingContext=true 时才进行历史图片回溯；usingContext=false 完全输入驱动，不做图片回填
  if (usingContext.value && imagesToSend.length === 0) {
    const assistantImages = findLastAssistantImages()
    if (assistantImages.length > 0) {
      imagesToSend.push(...assistantImages)
      clearContextForEdit = true
    }
    else {
      const nearestUserImages = findNearestUserImages()
      if (nearestUserImages.length > 0)
        imagesToSend.push(...nearestUserImages)
    }
  }

  if (lastContext && usingContext.value)
    options = clearContextForEdit ? {} : { ...lastContext }

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
    let lastText = ''
    let lastThinking = ''
    const fetchChatAPIOnce = async () => {
      const extraBody = buildExtraBody(currentChatModel.value, usingThinking.value)
      const stripImageFromMarkdown = (s: string) => String(s || '')
        .replace(/\!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/<img[^>]*>/gi, '')
        .trim()
      // 如有图片附件：编辑模式仍走图片编辑；否则统一走 chat-process 并携带图片
      if (imagesToSend.length > 0 && isEditMode.value) {
        const editRes = await fetchImageEdit<{ markdown?: string; url?: string; urls?: string[] }>({
          prompt: message,
          images: imagesToSend,
          roomId: +uuid,
          messageUuid: chatUuid,
          model: currentChatModel.value
        })
        const markdown = (editRes as any)?.data?.markdown
        const urls = (editRes as any)?.data?.urls || []
        const url = (editRes as any)?.data?.url
        const text = markdown || (urls.length > 0 ? urls.map((u: string) => `![edited](${u})`).join('\n') : (url ? `![edited](${url})` : ''))
        updateChat(
          +uuid,
          dataSources.value.length - 1,
          {
            dateTime: Date.now(),
            text,
            inversion: false,
            error: false,
            loading: false,
            thinking: '',
            thinkingExpanded: false,
            conversationOptions: null,
            requestOptions: { prompt: message, options: { ...options } },
          },
        )
        return
      }
      await fetchChatAPIProcess<Chat.ConversationResponse>({
        roomId: +uuid,
        uuid: chatUuid,
        prompt: imagesToSend.length > 0 ? stripImageFromMarkdown(message) : message,
        images: imagesToSend.length > 0 ? imagesToSend : undefined,
        options,
        extra_body: extraBody,
        draw: usingDraw.value,
        signal: ctrl.signal,
        onDownloadProgress: ({ event }) => {
          const xhr = event.target
          const { responseText } = xhr
          // Always process the final line
          const lastIndex = responseText.lastIndexOf('\n', responseText.length - 2)
          let chunk = responseText
          if (lastIndex !== -1)
            chunk = responseText.substring(lastIndex)
          try {
            const data = JSON.parse(chunk)
            const usage = (data.detail && data.detail.usage)
              ? {
                  completion_tokens: data.detail.usage.completion_tokens || null,
                  prompt_tokens: data.detail.usage.prompt_tokens || null,
                  total_tokens: data.detail.usage.total_tokens || null,
                  estimated: data.detail.usage.estimated || null,
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
                text: lastText + (data.text ?? ''),
                inversion: false,
                error: false,
                loading: true,
                thinking: lastThinking,
                thinkingExpanded: false,
                conversationOptions: { conversationId: data.conversationId, parentMessageId: data.id },
                requestOptions: { prompt: message, options: { ...options }, images: imagesToSend.length > 0 ? imagesToSend : undefined },
                usage,
              },
            )

            if (openLongReply && data.detail && data.detail.choices.length > 0 && data.detail.choices[0].finish_reason === 'length') {
              options.parentMessageId = data.id
              lastText = data.text
              message = ''
              return fetchChatAPIOnce()
            }

            scrollToBottomIfAtBottom()
          }
          catch (error) {
            //
          }
        },
      })
      updateChatSome(+uuid, dataSources.value.length - 1, { loading: false, thinkingExpanded: false })
    }

    await fetchChatAPIOnce()
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
    let lastText = ''
    let lastThinking = ''
    const fetchChatAPIOnce = async () => {
      const extraBody = buildExtraBody(currentChatModel.value, usingThinking.value)
      const originalImages: string[] = (dataSources.value[index]?.requestOptions as any)?.images || []
      const stripImageFromMarkdown = (s: string) => String(s || '')
        .replace(/\!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/<img[^>]*>/gi, '')
        .trim()
      await fetchChatAPIProcess<Chat.ConversationResponse>({
        roomId: +uuid,
        uuid: chatUuid || Date.now(),
        regenerate: true,
        prompt: originalImages.length > 0 ? stripImageFromMarkdown(message) : message,
        images: originalImages.length > 0 ? originalImages : undefined,
        options,
        extra_body: extraBody,
        draw: usingDraw.value,
        signal: ctrl.signal,
        onDownloadProgress: ({ event }) => {
          const xhr = event.target
          const { responseText } = xhr
          // Always process the final line
          const lastIndex = responseText.lastIndexOf('\n', responseText.length - 2)
          let chunk = responseText
          if (lastIndex !== -1)
            chunk = responseText.substring(lastIndex)
          try {
            const data = JSON.parse(chunk)
            const usage = (data.detail && data.detail.usage)
              ? {
                  completion_tokens: data.detail.usage.completion_tokens || null,
                  prompt_tokens: data.detail.usage.prompt_tokens || null,
                  total_tokens: data.detail.usage.total_tokens || null,
                  estimated: data.detail.usage.estimated || null,
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
                text: lastText + (data.text ?? ''),
                inversion: false,
                responseCount,
                error: false,
                loading: true,
                thinking: lastThinking,
                thinkingExpanded: false,
                conversationOptions: { conversationId: data.conversationId, parentMessageId: data.id },
                requestOptions: { prompt: message, options: { ...options }, images: originalImages.length > 0 ? originalImages : undefined },
                usage,
              },
            )

            if (openLongReply && data.detail && data.detail.choices.length > 0 && data.detail.choices[0].finish_reason === 'length') {
              options.parentMessageId = data.id
              lastText = data.text
              message = ''
              return fetchChatAPIOnce()
            }
          }
          catch (error) {
            //
          }
        },
      })
      updateChatSome(+uuid, index, { loading: false, thinkingExpanded: false })
    }
    await fetchChatAPIOnce()
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
      const next = list[0]
      if (next)
        handleSyncChatModel(next)
    }
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
          class="w-full max-w-screen-xl m-auto dark:bg-[#101014]"
          :class="[isMobile ? 'p-2' : 'p-4']"
        >
          <NSpin :show="firstLoading">
            <template v-if="!dataSources.length">
              <div class="flex items-center justify-center mt-4 text-center text-neutral-300">
                <SvgIcon icon="ri:bubble-chart-fill" class="mr-2 text-3xl" />
                <span>Aha~</span>
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
                  :response-count="item.responseCount"
                  :usage="item && item.usage || undefined"
                  :error="item.error"
                  :loading="item.loading"
                  @regenerate="onRegenerate(index)"
                  @delete="handleDelete(index)"
                  @response-history="(ev) => onResponseHistory(index, ev)"
                />
                <div class="sticky bottom-0 left-0 flex justify-center">
                  <NButton v-if="loading" type="warning" @click="handleStop">
                    <template #icon>
                      <SvgIcon icon="ri:stop-circle-line" />
                    </template>
                    Stop Responding
                  </NButton>
                </div>
              </div>
            </template>
          </NSpin>
        </div>
      </div>
    </main>
    <footer :class="footerClass">
      <div class="w-full max-w-screen-xl m-auto">
        <NSpace vertical>
          <div class="flex items-center space-x-2">
            <HoverButton v-if="!isMobile" @click="handleClear">
              <span class="text-xl text-[#4f555e] dark:text-white">
                <SvgIcon icon="ri:delete-bin-line" />
              </span>
            </HoverButton>
            <HoverButton v-if="!isMobile" @click="handleExport">
              <span class="text-xl text-[#4f555e] dark:text-white">
                <SvgIcon icon="ri:download-2-line" />
              </span>
            </HoverButton>
            <HoverButton v-if="!isMobile" @click="showPrompt = true">
              <span class="text-xl text-[#4f555e] dark:text-white">
                <IconPrompt class="w-[20px] m-auto" />
              </span>
            </HoverButton>
            <HoverButton v-if="!isMobile" @click="handleToggleUsingContext">
              <span class="text-xl" :class="{ 'text-[#4b9e5f]': usingContext, 'text-[#a8071a]': !usingContext && !usingDraw, 'text-gray-400': usingDraw }">
                <SvgIcon icon="ri:chat-history-line" />
              </span>
            </HoverButton>
          <HoverButton v-if="!isMobile" @click="handleToggleUsingThinking">
            <span class="text-xl" :class="{ 'text-[#4b9e5f]': usingThinking, 'text-[#a8071a]': !usingThinking }">
              <SvgIcon icon="ri:lightbulb-line" />
            </span>
          </HoverButton>
          <HoverButton v-if="!isMobile" @click="handleToggleUsingDraw">
            <span class="text-xl" :class="{ 'text-[#4b9e5f]': usingDraw, 'text-[#a8071a]': !usingDraw }">
              <SvgIcon icon="ri:image-line" />
            </span>
          </HoverButton>
          <HoverButton v-if="!isMobile" @click="triggerAttach">
            <span class="text-xl text-[#4f555e] dark:text-white">
              <SvgIcon icon="ri:attachment-2" />
            </span>
          </HoverButton>
          <HoverButton v-if="!isMobile && showEditButton" @click="isEditMode = !isEditMode">
            <span class="text-xl" :class="{ 'text-[#4b9e5f]': isEditMode, 'text-[#4f555e] dark:text-white': !isEditMode }">
              <SvgIcon icon="ri:scissors-cut-line" />
            </span>
          </HoverButton>
          <NSelect
            style="width: 250px"
            :value="currentChatModel"
            :options="authStore.session?.chatModels"
            :disabled="!!authStore.session?.auth && !authStore.token"
            @update-value="(val) => handleSyncChatModel(val)"
          />
          <HoverButton v-if="isMobile" @click="handleClear">
            <span class="text-xl text-[#4f555e] dark:text-white">
              <SvgIcon icon="ri:delete-bin-line" />
            </span>
          </HoverButton>
          <HoverButton v-if="isMobile" @click="handleToggleUsingDraw">
            <span class="text-xl" :class="{ 'text-[#4b9e5f]': usingDraw, 'text-[#a8071a]': !usingDraw }">
              <SvgIcon icon="ri:image-line" />
            </span>
          </HoverButton>
          <HoverButton v-if="isMobile" @click="triggerAttach">
            <span class="text-xl text-[#4f555e] dark:text-white">
              <SvgIcon icon="ri:attachment-2" />
            </span>
          </HoverButton>
        </div>
        <div class="flex items-center justify-between space-x-2">
          <NAutoComplete v-model:value="prompt" :options="searchOptions" :render-label="renderOption">
            <template #default="{ handleInput, handleBlur, handleFocus }">
              <NInput
                ref="inputRef"
                v-model:value="prompt"
                :disabled="!!authStore.session?.auth && !authStore.token"
                type="textarea"
                :placeholder="placeholder"
                :autosize="{ minRows: isMobile ? 1 : 4, maxRows: isMobile ? 4 : 8 }"
                @input="handleInput"
                @focus="handleFocus"
                @blur="handleBlur"
                @keypress="handleEnter"
                @paste="handlePaste"
              />
            </template>
          </NAutoComplete>
          <NButton type="primary" :disabled="buttonDisabled" @click="handleSubmit">
            <template #icon>
              <span class="dark:text-black">
                <SvgIcon icon="ri:send-plane-fill" />
              </span>
            </template>
          </NButton>
        </div>
        <div v-if="attachedImageUrls.length > 0" class="mt-2 flex flex-wrap gap-2">
          <div
            v-for="(u, index) in attachedImageUrls"
            :key="u"
            class="relative w-16 h-16"
          >
            <img :src="u" class="w-16 h-16 object-cover rounded border" />
            <button
              v-if="!isMobile"
              type="button"
              class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity"
              @click="removeAttachedImage(index)"
            >
              <span class="text-white text-lg">
                <SvgIcon icon="ri:delete-bin-line" />
              </span>
            </button>
            <button
              v-else
              type="button"
              class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center"
              @click="removeAttachedImage(index)"
            >
              <span class="text-white text-xs">
                <SvgIcon icon="ri:close-fill" />
              </span>
            </button>
          </div>
        </div>
      </NSpace>
    </div>
  </footer>
  <input ref="fileInputRef" type="file" style="position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; z-index: -1;" accept="image/*" multiple @change="onFilesSelected">
  <Prompt v-if="showPrompt" v-model:roomId="uuid" v-model:visible="showPrompt" />
</div>
</template>
