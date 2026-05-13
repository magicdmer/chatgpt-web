<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface Props {
  content?: string
  expanded?: boolean
  loading?: boolean
}

const props = defineProps<Props>()

const internalExpanded = ref<boolean>(false)

watch(() => props.expanded, (val) => {
  internalExpanded.value = !!val
})

const headerText = computed(() => {
  if (props.loading)
    return '思考中…'
  return '思考过程'
})

function toggle() {
  internalExpanded.value = !internalExpanded.value
}
</script>

<template>
  <div class="thinking-box" :class="{ 'is-loading': loading }">
    <div class="thinking-header" @click="toggle">
      <div class="thinking-title">
        <span v-if="loading" class="thinking-dot" />
        <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span>{{ headerText }}</span>
      </div>
      <div class="thinking-toggle">{{ internalExpanded ? '折叠' : '展开' }}</div>
    </div>
    <Transition name="thinking-content">
      <div v-show="internalExpanded" class="thinking-body">
        <div class="whitespace-pre-wrap text-xs" style="color: var(--text-secondary)">{{ content }}</div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.thinking-box {
  align-self: stretch;
  width: 100%;
  border-radius: var(--radius-md);
  border: 1px solid rgba(99, 102, 241, 0.2);
  background: rgba(99, 102, 241, 0.04);
  overflow: hidden;
  transition: all var(--transition-base);
}

html.dark .thinking-box {
  background: rgba(99, 102, 241, 0.06);
  border-color: rgba(129, 140, 248, 0.2);
}

.thinking-box.is-loading {
  animation: thinking-pulse 2s ease-in-out infinite;
}

.thinking-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}

.thinking-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--brand-primary);
}

html.dark .thinking-title {
  color: #818cf8;
}

.thinking-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-primary);
  animation: thinking-pulse 1.2s ease-in-out infinite;
}

.thinking-toggle {
  font-size: 12px;
  color: var(--text-muted);
  transition: color var(--transition-fast);
}

.thinking-toggle:hover {
  color: var(--brand-primary);
}

.thinking-body {
  padding: 0 12px 10px;
}

/* Transition */
.thinking-content-enter-active,
.thinking-content-leave-active {
  transition: all var(--transition-base);
  max-height: 2000px;
  opacity: 1;
}

.thinking-content-enter-from,
.thinking-content-leave-to {
  max-height: 0;
  opacity: 0;
}

@keyframes thinking-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
</style>