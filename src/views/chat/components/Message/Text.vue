<script lang="ts" setup>
import { computed, onMounted, onUnmounted, onUpdated, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import mdKatex from '@traptitech/markdown-it-katex'
import mila from 'markdown-it-link-attributes'
import hljs from 'highlight.js'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { t } from '@/locales'
import { copyToClip } from '@/utils/copy'

interface Props {
  inversion?: boolean
  error?: boolean
  text?: string
  loading?: boolean
  asRawText?: boolean
}

const props = defineProps<Props>()

const { isMobile } = useBasicLayout()

const textRef = ref<HTMLElement>()

const mdi = new MarkdownIt({
  html: false,
  linkify: true,
  highlight(code, language) {
    const validLang = !!(language && hljs.getLanguage(language))
    if (validLang) {
      const lang = language ?? ''
      return highlightBlock(hljs.highlight(code, { language: lang }).value, lang)
    }
    return highlightBlock(hljs.highlightAuto(code).value, '')
  },
})

mdi.use(mila, { attrs: { target: '_blank', rel: 'noopener' } })
mdi.use(mdKatex, { blockClass: 'katexmath-block rounded-md p-[10px]', errorColor: ' #cc0000' })

const text = computed(() => {
  let value = props.text ?? ''
  
  // 简单的解决方法：将 markdown 中的 http:// 图片链接替换为使用 wsrv.nl 代理（将 http 升级为 https）
  // 匹配 markdown 图片语法: ![alt](http://...)
  value = value.replace(/!\[([^\]]*)\]\((http:\/\/[^\)]+)\)/g, (match, alt, url) => {
    // 将原 http 链接通过 wsrv.nl 代理访问
    const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}`
    return `![${alt}](${proxyUrl})`
  })

  if (!props.asRawText) {
    return mdi.render(value)
  }
  
  return value
})

const wrapClass = computed(() => {
  return [
    'text-wrap',
    'min-w-[20px]',
    isMobile.value ? 'p-2' : 'px-3 py-2',
    props.inversion ? 'message-bubble-user' : 'message-bubble-ai',
    { 'text-red-500': props.error },
    { 'no-bg': props.loading && !text.value && !props.inversion },
  ]
})

function highlightBlock(str: string, lang?: string) {
  return `<pre class="code-block-wrapper"><div class="code-block-header"><span class="code-block-header__lang">${lang}</span><span class="code-block-header__copy">${t('chat.copyCode')}</span></div><code class="hljs code-block-body ${lang}">${str}</code></pre>`
}

function addCopyEvents() {
  if (textRef.value) {
    const copyBtn = textRef.value.querySelectorAll('.code-block-header__copy')
    copyBtn.forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.parentElement?.nextElementSibling?.textContent
        if (code) {
          copyToClip(code).then(() => {
            btn.textContent = '复制成功'
            setTimeout(() => {
              btn.textContent = '复制代码'
            }, 1000)
          })
        }
      })
    })
  }
}
function removeCopyEvents() {
  if (textRef.value) {
    const copyBtn = textRef.value.querySelectorAll('.code-block-header__copy')
    copyBtn.forEach((btn) => {
      btn.removeEventListener('click', () => { })
    })
  }
}
onMounted(() => {
  addCopyEvents()
})
onUpdated(() => {
  addCopyEvents()
})
onUnmounted(() => {
  removeCopyEvents()
})
</script>

<template>
  <div :class="wrapClass">
    <div ref="textRef" class="leading-relaxed break-words">
      <div v-if="!inversion" class="flex items-end">
        <template v-if="loading && !text">
          <div class="typing-indicator">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
          </div>
        </template>
        <template v-else>
          <div v-if="!props.asRawText" class="w-full markdown-body" v-html="text" />
          <div v-else class="w-full whitespace-pre-wrap" v-text="text" />
        </template>
      </div>
      <div v-else>
        <div v-if="!props.asRawText" class="w-full markdown-body" v-html="text" />
        <div v-else class="w-full whitespace-pre-wrap" v-text="text" />
      </div>
    </div>
  </div>
</template>

<style lang="less">
@import url(./style.less);
</style>

<style scoped>
.typing-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  gap: 4px;
  height: 24px;
}

.typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--text-primary, #666);
  animation: typing-bounce 1.4s infinite ease-in-out both;
}

.typing-dot:nth-child(1) {
  animation-delay: -0.32s;
}

.typing-dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes typing-bounce {
  0%, 80%, 100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.message-bubble-user {
  border-radius: var(--radius-md);
  background: var(--surface-bubble-user);
  color: var(--text-primary);
}

.message-bubble-user :deep(.markdown-body) {
  color: var(--text-primary) !important;
}

.message-bubble-user :deep(.markdown-body) a {
  color: var(--brand-primary) !important;
}

.message-bubble-ai {
  border-radius: var(--radius-md);
  background: var(--surface-bubble-ai);
  color: var(--text-primary);
}

.no-bg {
  background: transparent !important;
}
</style>
