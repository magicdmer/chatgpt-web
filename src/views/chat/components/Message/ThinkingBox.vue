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
  <div class="self-stretch w-full rounded-md border border-yellow-300 bg-yellow-50 dark:bg-[#2a2a1f] dark:border-yellow-600">
    <div class="flex items-center justify-between px-3 py-2 cursor-pointer select-none" @click="toggle">
      <div class="text-xs text-yellow-800 dark:text-yellow-200">{{ headerText }}</div>
      <div class="text-xs text-yellow-800 dark:text-yellow-200">{{ internalExpanded ? '折叠' : '展开' }}</div>
    </div>
    <div v-show="internalExpanded" class="px-3 pb-3">
      <div class="whitespace-pre-wrap text-xs text-[#3a3a3a] dark:text-[#d0d0c0]">{{ content }}</div>
    </div>
  </div>
  
</template>

<style scoped>
</style>