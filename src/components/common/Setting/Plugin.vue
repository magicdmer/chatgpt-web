<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import {
  NButton,
  NDataTable,
  NDynamicInput,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui'
import {
  fetchPluginList,
  fetchPluginModels,
  fetchPublishPlugin,
  fetchRefreshPlugins,
  fetchUpdatePluginEnabled,
  fetchUpdatePluginSettings,
} from '@/api'
import { useUserStore } from '@/store'

interface SettingDefinition {
  description: string
  type: 'string' | 'text' | 'int' | 'float' | 'boolean' | 'list' | 'select' | 'model'
  hint?: string
  obvious_hint?: boolean
  default: any
  required?: boolean
  secret?: boolean
  placeholder?: string
  min?: number
  max?: number
  options?: Array<{ label: string; value: string | number }>
}

interface PluginItem {
  id: string
  name: string
  version: string
  description: string
  published: boolean
  enabled: boolean
  tools: Array<{ name: string; description: string }>
  settings?: Record<string, any>
  settingsSchema?: Record<string, SettingDefinition>
  configuredSecrets?: string[]
  loadError?: string
}

const message = useMessage()
const userStore = useUserStore()
const loading = ref(false)
const refreshing = ref(false)
const saving = ref(false)
const loadingModels = ref(false)
const plugins = ref<PluginItem[]>([])
const modelOptions = ref<Array<{ label: string; value: string }>>([])
const showSettings = ref(false)
const editingPlugin = ref<PluginItem | null>(null)
const settingsForm = ref<Record<string, any>>({})

const isAdmin = computed(() => userStore.userInfo.root)

function settingOptions(definition: SettingDefinition) {
  return definition.type === 'model' ? modelOptions.value : (definition.options || [])
}

function settingPlaceholder(definition: SettingDefinition, key: string | number) {
  if (definition.secret && editingPlugin.value?.configuredSecrets?.includes(String(key)))
    return '已配置，留空表示不修改'
  if (definition.type === 'model')
    return modelOptions.value.length > 0 ? '请选择模型' : '暂无模型，请先在 Keys 管理中刷新'
  return definition.placeholder || definition.hint
}

async function loadPlugins() {
  loading.value = true
  try {
    const { data } = await fetchPluginList<PluginItem[]>()
    plugins.value = data || []
  }
  catch (error: any) {
    message.error(error?.message || '获取插件列表失败')
  }
  finally {
    loading.value = false
  }
}

async function refreshPlugins() {
  refreshing.value = true
  try {
    await fetchRefreshPlugins()
    await loadPlugins()
    message.success('插件已刷新')
  }
  catch (error: any) {
    message.error(error?.message || '刷新插件失败')
  }
  finally {
    refreshing.value = false
  }
}

async function toggleEnabled(row: PluginItem) {
  try {
    await fetchUpdatePluginEnabled(row.id, !row.enabled)
    message.success(row.enabled ? '插件已停用' : '插件已启用')
    await loadPlugins()
  }
  catch (error: any) {
    message.error(error?.message || '插件状态更新失败')
  }
}

async function togglePublished(row: PluginItem) {
  try {
    await fetchPublishPlugin(row.id, !row.published)
    message.success(row.published ? '已取消发布' : '插件已发布')
    await loadPlugins()
  }
  catch (error: any) {
    message.error(error?.message || '发布状态更新失败')
  }
}

async function openSettings(row: PluginItem) {
  editingPlugin.value = row
  settingsForm.value = JSON.parse(JSON.stringify(row.settings || {}))
  showSettings.value = true

  const hasModelSetting = Object.values(row.settingsSchema || {}).some(definition => definition.type === 'model')
  if (!hasModelSetting)
    return

  loadingModels.value = true
  modelOptions.value = []
  try {
    const { data } = await fetchPluginModels<string[]>()
    modelOptions.value = (data || []).map(model => ({ label: model, value: model }))
  }
  catch (error: any) {
    message.error(error?.message || '读取模型列表失败')
  }
  finally {
    loadingModels.value = false
  }
}

async function saveSettings() {
  if (!editingPlugin.value)
    return
  saving.value = true
  try {
    await fetchUpdatePluginSettings(editingPlugin.value.id, settingsForm.value)
    message.success('插件设置已保存')
    showSettings.value = false
    await loadPlugins()
  }
  catch (error: any) {
    message.error(error?.message || '插件设置保存失败')
  }
  finally {
    saving.value = false
  }
}

const columns = computed(() => {
  const result: any[] = [
    {
      title: '插件名称',
      key: 'name',
      minWidth: 180,
      render(row: PluginItem) {
        return h('div', [
          h('div', { class: 'font-medium' }, row.name),
          h('div', { class: 'text-xs text-gray-400 mt-1' }, row.description),
          row.loadError ? h('div', { class: 'text-xs text-red-500 mt-1' }, row.loadError) : null,
        ])
      },
    },
    {
      title: '工具',
      key: 'tools',
      minWidth: 180,
      render(row: PluginItem) {
        return h(NSpace, { size: 4 }, {
          default: () => row.tools.map(tool => h(NTag, { size: 'small', bordered: false }, { default: () => tool.name })),
        })
      },
    },
    {
      title: '状态',
      key: 'enabled',
      width: 100,
      render(row: PluginItem) {
        return h(NTag, { type: row.enabled ? 'success' : 'default', bordered: false }, {
          default: () => row.enabled ? '已启用' : '未启用',
        })
      },
    },
  ]

  if (isAdmin.value) {
    result.push({
      title: '发布状态',
      key: 'published',
      width: 100,
      render(row: PluginItem) {
        return h(NTag, { type: row.published ? 'info' : 'default', bordered: false }, {
          default: () => row.published ? '已发布' : '未发布',
        })
      },
    })
  }

  result.push({
    title: '操作',
    key: 'actions',
    width: isAdmin.value ? 270 : 100,
    render(row: PluginItem) {
      const actions = [
        h(NButton, {
          size: 'small',
          type: row.enabled ? 'warning' : 'primary',
          disabled: Boolean(row.loadError),
          onClick: () => toggleEnabled(row),
        }, { default: () => row.enabled ? '停用' : '启用' }),
      ]
      if (isAdmin.value) {
        actions.push(h(NButton, {
          size: 'small',
          type: 'info',
          disabled: Boolean(row.loadError) || !row.settingsSchema || Object.keys(row.settingsSchema).length === 0,
          onClick: () => openSettings(row),
        }, { default: () => '设置' }))
        actions.push(h(NButton, {
          size: 'small',
          type: row.published ? 'warning' : 'success',
          disabled: Boolean(row.loadError),
          onClick: () => togglePublished(row),
        }, { default: () => row.published ? '取消发布' : '发布' }))
      }
      return h(NSpace, { size: 6 }, { default: () => actions })
    },
  })
  return result
})

onMounted(loadPlugins)
</script>

<template>
  <div class="p-4 min-h-[200px]">
    <div v-if="isAdmin" class="flex justify-end mb-3">
      <NButton :loading="refreshing" :disabled="loading" @click="refreshPlugins">
        刷新
      </NButton>
    </div>
    <NDataTable
      :columns="columns"
      :data="plugins"
      :loading="loading"
      :pagination="false"
      :row-key="(row) => row.id"
      :scroll-x="isAdmin ? 850 : 650"
      striped
    />
  </div>

  <NModal
    v-model:show="showSettings"
    preset="card"
    :title="`${editingPlugin?.name || ''} 设置`"
    style="width: 90%; max-width: 620px"
  >
    <template v-if="editingPlugin?.settingsSchema">
      <NFormItem
        v-for="(definition, key) in editingPlugin.settingsSchema"
        :key="key"
        :label="definition.description"
        :required="definition.required"
      >
        <NInput
          v-if="definition.type === 'string' || definition.type === 'text'"
          v-model:value="settingsForm[key]"
          :type="definition.type === 'text' ? 'textarea' : (definition.secret ? 'password' : 'text')"
          :show-password-on="definition.secret ? 'mousedown' : undefined"
          :placeholder="settingPlaceholder(definition, key)"
        />
        <NInputNumber
          v-else-if="definition.type === 'int' || definition.type === 'float'"
          v-model:value="settingsForm[key]"
          :min="definition.min"
          :max="definition.max"
          :precision="definition.type === 'int' ? 0 : undefined"
          :placeholder="settingPlaceholder(definition, key)"
          class="w-full"
        />
        <NSwitch
          v-else-if="definition.type === 'boolean'"
          v-model:value="settingsForm[key]"
        />
        <NSelect
          v-else-if="definition.type === 'select' || definition.type === 'model'"
          v-model:value="settingsForm[key]"
          :options="settingOptions(definition)"
          :placeholder="settingPlaceholder(definition, key)"
          :loading="definition.type === 'model' && loadingModels"
          filterable
        />
        <NDynamicInput
          v-else-if="definition.type === 'list'"
          v-model:value="settingsForm[key]"
          preset="input"
          :placeholder="settingPlaceholder(definition, key)"
          :min="0"
        />
      </NFormItem>
    </template>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showSettings = false">
          取消
        </NButton>
        <NButton type="primary" :loading="saving" @click="saveSettings">
          保存
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>
