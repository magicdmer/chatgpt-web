<script setup lang='ts'>
import { computed, ref, watch, h } from 'vue'
import { NCard, NDataTable, NModal, NSelect, useMessage } from 'naive-ui'
import { fetchPluginList, fetchUpdatePlugin } from '@/api'
import { useAuthStore } from '@/store'

interface Props {
  visible: boolean
}

interface Emit {
  (e: 'update:visible', visible: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()
const message = useMessage()
const authStore = useAuthStore()

const show = computed({
  get: () => props.visible,
  set: (visible: boolean) => emit('update:visible', visible),
})

const loading = ref(false)
const pluginList = ref<any[]>([])

// 获取可用模型列表 (和设置里一样)
const modelOptions = computed(() => {
  return authStore.session?.allChatModels || []
})

const columns = [
  {
    title: '插件名称',
    key: 'name',
    width: 150,
  },
  {
    title: '生图模型设置',
    key: 'modelSetting',
    render(row: any) {
      if (row.name === 'generate_image') {
        return h(NSelect, {
          value: row.settings?.model || 'dall-e-3',
          options: modelOptions.value,
          onUpdateValue: (val: string) => handleUpdateModel(row, val),
        })
      }
      return 'N/A'
    },
  },
]

async function loadPlugins() {
  loading.value = true
  try {
    const { data } = await fetchPluginList()
    pluginList.value = data || []
    // 检查是否存在 generate_image 插件，如果没有则补充默认显示
    if (!pluginList.value.find(p => p.name === 'generate_image')) {
      pluginList.value.push({
        name: 'generate_image',
        settings: { model: 'dall-e-3' }
      })
    }
  }
  catch (error: any) {
    message.error(error.message || 'Failed to load plugins')
  }
  finally {
    loading.value = false
  }
}

async function handleUpdateModel(row: any, modelValue: string) {
  try {
    const newSettings = { ...row.settings, model: modelValue }
    await fetchUpdatePlugin(row.name, newSettings)
    row.settings = newSettings
    message.success('设置已保存')
  }
  catch (error: any) {
    message.error(error.message || 'Failed to update plugin')
  }
}

watch(show, (val) => {
  if (val) {
    loadPlugins()
  }
})
</script>

<template>
  <NModal v-model:show="show" style="width: 90%; max-width: 600px;" preset="card">
    <template #header>
      <div>插件商店 (管理员)</div>
    </template>
    <NCard :bordered="false" size="small" role="dialog" aria-modal="true">
      <NDataTable
        :columns="columns"
        :data="pluginList"
        :loading="loading"
        :pagination="false"
      />
    </NCard>
  </NModal>
</template>
