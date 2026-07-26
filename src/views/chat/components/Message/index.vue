<script setup lang='ts'>
import { computed, ref, watch } from 'vue'
import { NButton, NButtonGroup, NDropdown, NPopover, NSpace, useMessage } from 'naive-ui'
import TextComponent from './Text.vue'
import ThinkingBox from './ThinkingBox.vue'
import { SvgIcon } from '@/components/common'
import { useIconRender } from '@/hooks/useIconRender'
import { t } from '@/locales'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { copyToClip } from '@/utils/copy'
import dayjs from 'dayjs'

interface Props {
  dateTime?: number
  text?: string
  inversion?: boolean
  error?: boolean
  loading?: boolean
  thinking?: string
  thinkingExpanded?: boolean
  toolStatus?: string
  responseCount?: number
  usage?: {
    completion_tokens: number
    prompt_tokens: number
    total_tokens: number
    estimated: boolean
  }
}
const props = defineProps<Props>()

const emit = defineEmits<Emit>()

interface Emit {
  (ev: 'regenerate'): void
  (ev: 'delete'): void
  (ev: 'responseHistory', historyIndex: number): void
}

const { isMobile } = useBasicLayout()

const { iconRender } = useIconRender()

const message = useMessage()

const textRef = ref<HTMLElement>()

const asRawText = ref(props.inversion)

const messageRef = ref<HTMLElement>()

const indexRef = ref<number>(0)
indexRef.value = props.responseCount ?? 0

const url_openai_token = 'https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them'

const options = computed(() => {
  const common = [
    {
      label: t('chat.copy'),
      key: 'copyText',
      icon: iconRender({ icon: 'ri:file-copy-2-line' }),
    },
    {
      label: t('common.delete'),
      key: 'delete',
      icon: iconRender({ icon: 'ri:delete-bin-line' }),
    },
  ]

  if (!props.inversion) {
    common.unshift({
      label: asRawText.value ? t('chat.preview') : t('chat.showRawText'),
      key: 'toggleRenderType',
      icon: iconRender({ icon: asRawText.value ? 'ic:outline-code-off' : 'ic:outline-code' }),
    })
  }

  return common
})

function autoRenderForUser() {
  if (props.inversion) {
    const txt = props.text || ''
    const hasMarkdownImage = /\!\[.*?\]\(.+?\)/.test(txt)
    asRawText.value = !hasMarkdownImage
  }
}
watch(() => props.text, autoRenderForUser, { immediate: true })

function handleSelect(key: 'copyText' | 'delete' | 'toggleRenderType') {
  switch (key) {
    case 'copyText':
      handleCopy()
      return
    case 'toggleRenderType':
      asRawText.value = !asRawText.value
      return
    case 'delete':
      emit('delete')
  }
}

function handleRegenerate() {
  messageRef.value?.scrollIntoView()
  emit('regenerate')
}

async function handleCopy() {
  try {
    await copyToClip(props.text || '')
    message.success('复制成功')
  }
  catch {
    message.error('复制失败')
  }
}

async function handlePreviousResponse(next: number) {
  if (indexRef.value + next < 1 || indexRef.value + next > props.responseCount!)
    return
  indexRef.value += next
  emit('responseHistory', indexRef.value - 1)
}
</script>

<template>
  <div
    ref="messageRef"
    class="message-row"
    :class="[{ 'flex-row-reverse': inversion }]"
  >
    <div class="flex-1 min-w-0 text-sm" :class="[inversion ? 'items-end' : 'items-start']">
      <p v-if="inversion" class="message-meta" :class="[inversion ? 'text-right' : 'text-left']">
        {{ dateTime ? dayjs(dateTime).format('YYYY/MM/DD HH:mm:ss') : '' }}
      </p>
      <p v-else class="message-meta" :class="[inversion ? 'text-right' : 'text-left']">
        <NSpace>
          {{ dateTime ? dayjs(dateTime).format('YYYY/MM/DD HH:mm:ss') : '' }}
          <NButtonGroup v-if="!inversion && responseCount && responseCount > 1">
            <NButton
              style="cursor: pointer;"
              size="tiny" quaternary
              :disabled="indexRef === 1"
              @click="handlePreviousResponse(-1)"
            >
              <svg stroke="currentColor" fill="none" stroke-width="1.5" viewBox="-3 3 24 24" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><polyline points="15 18 9 12 15 6" /></svg>
            </NButton>
            <span class="message-meta"> {{ indexRef }} / {{ responseCount }}</span>
            <NButton
              style="cursor: pointer;"
              size="tiny" quaternary
              :disabled="indexRef === responseCount"
              @click="handlePreviousResponse(1)"
            >
              <svg stroke="currentColor" fill="none" stroke-width="1.5" viewBox="3 3 24 24" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><polyline points="9 18 15 12 9 6" /></svg>
            </NButton>
          </NButtonGroup>
          <template v-if="usage">
            <NPopover trigger="hover">
              <template #trigger>
                <span>
                  <span>[</span>
                  <span>{{ usage.estimated ? '~' : '' }}</span>
                  <span>{{ usage.prompt_tokens }}+{{ usage.completion_tokens }}={{ usage.total_tokens }}</span>
                  <span>]</span>
                </span>
              </template>
              <span class="text-xs">
                {{ usage.estimated ? t('chat.usageEstimate') : '' }}
                {{ t('chat.usagePrompt') }} {{ usage.prompt_tokens }}
                + {{ t('chat.usageResponse') }} {{ usage.completion_tokens }}
                = {{ t('chat.usageTotal') }}<a :href="url_openai_token" target="_blank">(?)</a>
                {{ usage.total_tokens }}
              </span>
            </NPopover>
          </template>
        </NSpace>
      </p>
      <div class="flex flex-col gap-2 mt-2 min-w-0" :class="[inversion ? 'items-end' : 'items-start']">
        <ThinkingBox v-if="!inversion && props.thinking && props.thinking.length > 0"
          :content="props.thinking"
          :expanded="props.thinkingExpanded"
          :loading="props.loading"
        />
        <div v-if="!inversion && props.toolStatus" class="tool-status-chip">
          <span class="tool-status-dot" />
          <span>{{ props.toolStatus }}</span>
        </div>
        <TextComponent
          ref="textRef"
          :inversion="inversion"
          :error="error"
          :text="text"
          :loading="loading"
          :as-raw-text="asRawText"
        />
        <div class="message-actions flex flex-row items-center gap-1 mt-1">
          <button
            v-if="!inversion"
            class="message-action-btn"
            @click="handleRegenerate"
          >
            <SvgIcon icon="ri:restart-line" />
          </button>
          <NDropdown
            :trigger="isMobile ? 'click' : 'hover'"
            placement="bottom"
            :options="options"
            @select="handleSelect"
          >
            <button class="message-action-btn">
              <SvgIcon icon="ri:more-2-fill" />
            </button>
          </NDropdown>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-row {
  display: flex;
  width: 100%;
  margin-bottom: 24px;
  animation: fadeInUp 0.35s ease-out both;
}

.message-meta {
  font-size: 12px;
  color: var(--text-muted);
}

.message-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.tool-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: color-mix(in srgb, var(--surface-bubble-ai) 88%, transparent);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1;
}

.tool-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--brand-primary);
  animation: tool-status-pulse 1.2s ease-in-out infinite;
}

.message-row:hover .message-actions {
  opacity: 1;
}

@keyframes tool-status-pulse {
  0%, 100% {
    transform: scale(0.9);
    opacity: 0.55;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}

.message-action-btn {
  padding: 4px;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.message-action-btn:hover {
  color: var(--brand-primary);
  background: var(--surface-hover);
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
