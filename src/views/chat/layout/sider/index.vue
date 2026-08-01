<script setup lang='ts'>
import type { CSSProperties } from 'vue'
import { computed, ref, watch } from 'vue'
import { NLayoutSider } from 'naive-ui'
import List from './List.vue'
import Footer from './Footer.vue'
import { useAppStore, useAuthStore, useChatStore } from '@/store'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { PromptStore, SvgIcon } from '@/components/common'
import { getDefaultChatModel } from '@/utils/chatModel'

const appStore = useAppStore()
const authStore = useAuthStore()
const chatStore = useChatStore()

const { isMobile } = useBasicLayout()
const show = ref(false)

const collapsed = computed(() => appStore.siderCollapsed)

async function handleAdd() {
  await chatStore.addHistory({ title: 'New Chat', titleSource: 'placeholder', uuid: Date.now(), isEdit: false, usingContext: true, chatModel: getDefaultChatModel() })
  if (isMobile.value)
    appStore.setSiderCollapsed(true)
}

function handleUpdateCollapsed() {
  appStore.setSiderCollapsed(!collapsed.value)
}

const getMobileClass = computed<CSSProperties>(() => {
  if (isMobile.value) {
    return {
      position: 'fixed',
      zIndex: 50,
    }
  }
  return {}
})

const mobileSafeArea = computed(() => {
  if (isMobile.value) {
    return {
      paddingBottom: 'env(safe-area-inset-bottom)',
    }
  }
  return {}
})

watch(
  isMobile,
  (val) => {
    appStore.setSiderCollapsed(val)
  },
  {
    immediate: true,
    flush: 'post',
  },
)
</script>

<template>
  <NLayoutSider
    :collapsed="collapsed"
    :collapsed-width="0"
    :width="260"
    :show-trigger="isMobile ? false : 'arrow-circle'"
    collapse-mode="transform"
    position="absolute"
    bordered
    :style="{ ...getMobileClass, background: 'var(--surface-sidebar)' }"
    @update-collapsed="handleUpdateCollapsed"
  >
    <div class="flex flex-col h-full" :style="mobileSafeArea">
      <main class="flex flex-col flex-1 min-h-0">
        <div class="p-4">
          <button
            class="sider-new-chat-btn"
            :disabled="!!authStore.session?.auth && !authStore.token"
            @click="handleAdd"
          >
            <SvgIcon icon="ri:add-line" class="text-lg" />
            <span>{{ $t('chat.newChatButton') }}</span>
          </button>
        </div>
        <div class="flex-1 min-h-0 pb-4 overflow-hidden">
          <List />
        </div>
        <div class="px-4 pb-2 flex flex-col gap-2">
          <button
            class="sider-prompt-btn"
            @click="show = true"
          >
            <SvgIcon icon="ri:booklet-line" class="text-base" />
            <span>{{ $t('store.siderButton') }}</span>
          </button>
        </div>
      </main>
      <Footer />
    </div>
  </NLayoutSider>
  <template v-if="isMobile">
    <div v-show="!collapsed" class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" @click="handleUpdateCollapsed" />
  </template>
  <PromptStore v-model:visible="show" />
</template>

<style scoped>
.sider-new-chat-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-weight: 500;
  font-size: 14px;
  cursor: pointer;
  transition: all var(--transition-base);
}

.sider-new-chat-btn:hover {
  background: var(--surface-hover);
  border-color: var(--text-muted);
}

.sider-new-chat-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sider-prompt-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-weight: 500;
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-base);
}

.sider-prompt-btn:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
</style>
