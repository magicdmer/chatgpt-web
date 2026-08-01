<script setup lang='ts'>
import { computed, nextTick, onMounted, ref } from 'vue'
import { NInput, NPopconfirm, NScrollbar, NSpin, useMessage } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { useAppStore, useChatStore } from '@/store'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { useAuthStoreWithout } from '@/store/modules/auth'
import { debounce } from '@/utils/functions/debounce'

const { isMobile } = useBasicLayout()

const appStore = useAppStore()
const chatStore = useChatStore()
const authStore = useAuthStoreWithout()
const ms = useMessage()

const loadingRoom = ref(false)

const dataSources = computed(() => chatStore.history)

onMounted(async () => {
  if (authStore.session == null || !authStore.session.auth || authStore.token)
    await handleSyncChatRoom()
})

async function handleSyncChatRoom() {
  loadingRoom.value = true
  chatStore.syncHistory(() => {
    loadingRoom.value = false
    // 本来这里不需要的, 但是 vue 渲染的时候 chat 可能优先渲染等原因 导致概率不刷新
    if (chatStore.active) {
      const uuid = chatStore.active
      chatStore.syncChat({ uuid } as Chat.History, undefined, () => {
        const scrollRef = document.querySelector('#scrollRef')
        if (scrollRef)
          nextTick(() => scrollRef.scrollTop = scrollRef.scrollHeight)
      })
    }
  })
}

async function handleSelect({ uuid }: Chat.History) {
  if (isActive(uuid))
    return

  // 这里不需要 不然每次切换都rename
  // if (chatStore.active)
  //   chatStore.updateHistory(chatStore.active, { isEdit: false })
  await chatStore.setActive(uuid)

  if (isMobile.value)
    appStore.setSiderCollapsed(true)
}

async function handleEdit({ uuid }: Chat.History, isEdit: boolean, event?: MouseEvent) {
  event?.stopPropagation()
  try {
    await chatStore.updateHistory(uuid, { isEdit })
  }
  catch (error: any) {
    ms.error(error?.message || '保存标题失败')
  }
}

function handleDelete(index: number, event?: MouseEvent | TouchEvent) {
  event?.stopPropagation()
  chatStore.deleteHistory(index)
  if (isMobile.value)
    appStore.setSiderCollapsed(true)
}

const handleDeleteDebounce = debounce(handleDelete, 600)

async function handleEnter({ uuid }: Chat.History, isEdit: boolean, event: KeyboardEvent) {
  event?.stopPropagation()
  if (event.key !== 'Enter')
    return
  try {
    await chatStore.updateHistory(uuid, { isEdit })
  }
  catch (error: any) {
    ms.error(error?.message || '保存标题失败')
  }
}

function isActive(uuid: number) {
  return chatStore.active === uuid
}
</script>

<template>
  <NScrollbar class="px-4">
    <NSpin :show="loadingRoom">
      <div class="flex flex-col gap-1.5 text-sm">
        <template v-if="!dataSources.length">
          <div class="flex flex-col items-center mt-4 text-center text-neutral-300">
            <SvgIcon icon="ri:inbox-line" class="mb-2 text-3xl" />
            <span>{{ $t('common.noData') }}</span>
          </div>
        </template>
        <template v-else>
          <div v-for="(item, index) of dataSources" :key="index">
            <a
              class="chat-history-item"
              :class="{ 'is-active': isActive(item.uuid) }"
              @click="handleSelect(item)"
            >
              <span class="chat-history-icon">
                <SvgIcon v-if="item.loading" icon="ri:loader-4-line" class="animate-spin text-[var(--brand-primary)]" />
                <SvgIcon v-else icon="ri:message-3-line" />
              </span>
              <div class="relative flex-1 overflow-hidden break-all text-ellipsis whitespace-nowrap">
                <NInput
                  v-if="item.isEdit"
                  v-model:value="item.title" size="tiny"
                  @keypress="handleEnter(item, false, $event)"
                />
                <span v-else>{{ item.title }}</span>
              </div>
              <div v-if="isActive(item.uuid)" class="absolute z-10 flex visible right-1 gap-0.5">
                <template v-if="item.isEdit">
                  <button class="chat-history-action" @click="handleEdit(item, false, $event)">
                    <SvgIcon icon="ri:save-line" />
                  </button>
                </template>
                <template v-else>
                  <button class="chat-history-action">
                    <SvgIcon icon="ri:edit-line" @click="handleEdit(item, true, $event)" />
                  </button>
                  <NPopconfirm placement="bottom" @positive-click="handleDeleteDebounce(index, $event)">
                    <template #trigger>
                      <button class="chat-history-action">
                        <SvgIcon icon="ri:delete-bin-line" />
                      </button>
                    </template>
                    {{ $t('chat.deleteHistoryConfirm') }}
                  </NPopconfirm>
                </template>
              </div>
            </a>
          </div>
        </template>
      </div>
    </NSpin>
  </NScrollbar>
</template>

<style scoped>
.chat-history-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-primary);
  transition: all var(--transition-fast);
  border: 1px solid transparent;
}

.chat-history-item:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.chat-history-item.is-active {
  background: var(--surface-hover);
  color: var(--text-primary);
  border-color: transparent;
  padding-right: 56px;
  font-weight: 500;
}

.chat-history-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  font-size: 15px;
}

.chat-history-action {
  padding: 4px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: all var(--transition-fast);
}

.chat-history-action:hover {
  color: var(--text-primary);
  background: var(--surface-active);
}
</style>
