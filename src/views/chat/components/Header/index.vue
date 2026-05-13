<script lang="ts" setup>
import { computed, nextTick } from 'vue'
import { HoverButton, SvgIcon } from '@/components/common'
import { useAppStore, useChatStore } from '@/store'
import IconPrompt from '@/icons/Prompt.vue'

interface Props {
  usingContext: boolean
  showPrompt: boolean
}

interface Emit {
  (ev: 'export'): void
  (ev: 'toggleUsingContext'): void
  (ev: 'toggleShowPrompt'): void
}

defineProps<Props>()

const emit = defineEmits<Emit>()

const appStore = useAppStore()
const chatStore = useChatStore()

const collapsed = computed(() => appStore.siderCollapsed)
const currentChatHistory = computed(() => chatStore.getChatHistoryByCurrentActive)

function handleUpdateCollapsed() {
  appStore.setSiderCollapsed(!collapsed.value)
}

function onScrollToTop() {
  const scrollRef = document.querySelector('#scrollRef')
  if (scrollRef)
    nextTick(() => scrollRef.scrollTop = 0)
}

function handleExport() {
  emit('export')
}

function toggleUsingContext() {
  emit('toggleUsingContext')
}

function handleShowPrompt() {
  emit('toggleShowPrompt')
}
</script>

<template>
  <header class="mobile-header">
    <div class="mobile-header-inner">
      <div class="flex items-center">
        <button
          class="flex items-center justify-center w-11 h-11"
          @click="handleUpdateCollapsed"
        >
          <SvgIcon v-if="collapsed" class="text-2xl" icon="ri:align-justify" style="color: var(--text-primary)" />
          <SvgIcon v-else class="text-2xl" icon="ri:align-right" style="color: var(--text-primary)" />
        </button>
      </div>
      <h1
        class="flex-1 px-4 pr-6 overflow-hidden cursor-pointer select-none text-ellipsis whitespace-nowrap"
        style="color: var(--text-primary); font-weight: 600;"
        @dblclick="onScrollToTop"
      >
        {{ currentChatHistory?.title ?? '' }}
      </h1>
      <div class="flex items-center space-x-1">
        <HoverButton @click="handleShowPrompt">
          <span class="text-xl" style="color: var(--text-muted)">
            <IconPrompt class="w-[20px] m-auto" />
          </span>
        </HoverButton>
        <HoverButton @click="toggleUsingContext">
          <span class="text-xl" :style="{ color: usingContext ? 'var(--brand-primary)' : 'var(--text-muted)' }">
            <SvgIcon icon="ri:chat-history-line" />
          </span>
        </HoverButton>
        <HoverButton @click="handleExport">
          <span class="text-xl" style="color: var(--text-muted)">
            <SvgIcon icon="ri:download-2-line" />
          </span>
        </HoverButton>
      </div>
    </div>
  </header>
</template>

<style scoped>
.mobile-header {
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--surface-input);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-subtle);
}

.mobile-header-inner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  overflow: hidden;
  height: 56px;
}
</style>
