<script lang="ts" setup>
import { h, onMounted, reactive, ref } from 'vue'
import { NButton, NDataTable, NInput, NModal, NSelect, NSpace, NSwitch, NTag, useDialog, useMessage } from 'naive-ui'
import { KeyConfig, Status, UserRole, userRoleOptions } from './model'
import { fetchGetKeys, fetchOpenAIModels, fetchUpdateApiKeyStatus, fetchUpsertApiKey } from '@/api'
import { t } from '@/locales'
import { ss } from '@/utils/storage'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { useAuthStore } from '@/store'
import { copyToClip } from '@/utils/copy'

const ms = useMessage()
const dialog = useDialog()
const authStore = useAuthStore()
const { isMobile } = useBasicLayout()

const loading = ref(false)
const show = ref(false)
const handleSaving = ref(false)
const keyConfig = ref(new KeyConfig('', '', [], [], ''))
const MODELS_LOCAL_NAME = 'modelsStorage'
const modelOptions = ref(authStore.session?.allChatModels || [])
function buildModelsNamespace(key?: string, baseUrl?: string) {
  const k = (key ?? '').trim()
  const b = (baseUrl ?? '').trim()
  if (!k)
    return null
  // 统一移除末尾斜杠，避免 `.../v1` 与 `.../v1/` 命名空间不一致
  const normalizedB = b ? b.replace(/\/+$/, '') : '__default_base__'
  return `${normalizedB}__${k}`
}
function getModelsCache(): Record<string, any[]> {
  const val: any = ss.get(MODELS_LOCAL_NAME)
  if (Array.isArray(val))
    return { __legacy__: val }
  return val || {}
}
function setModelsCache(ns: string, options: any[]) {
  const cache = getModelsCache()
  cache[ns] = options
  ss.set(MODELS_LOCAL_NAME, cache)
}
function getCachedOptions(ns: string): any[] | null {
  const cache = getModelsCache()
  return cache[ns] || null
}
// 下拉内置过滤函数：不区分大小写匹配 label/value
const filterSelectOption = (pattern: string, option: any) => {
  const text = String(option.label ?? option.value)
  return text.toLowerCase().includes(pattern.toLowerCase())
}

async function copyModelName(model: string) {
  try {
    await copyToClip(model)
    ms.success(`已复制模型名：${model}`)
  }
  catch (error) {
    ms.error('复制失败')
  }
}

const renderModelTag = ({ option, handleClose }: { option: any; handleClose: () => void }) => {
  const model = String(option.value ?? option.label ?? '')
  return h(
    NTag,
    {
      closable: true,
      bordered: false,
      type: 'info',
      title: '点击复制模型名',
      style: { cursor: 'copy' },
      onClick: (event: MouseEvent) => {
        event.stopPropagation()
        copyModelName(model)
      },
      onClose: (event: MouseEvent) => {
        event.stopPropagation()
        handleClose()
      },
    },
    { default: () => model },
  )
}
// 刷新当前 Key 的模型列表
const refreshingModels = ref(false)
const MIN_SPIN_MS = 400
const handleRefreshModels = async () => {
  if (!keyConfig.value?.key) {
    ms.warning('请先输入 API Key')
    return
  }
  let t0 = 0
  try {
    refreshingModels.value = true
    t0 = Date.now()
    // 刷新开始时清空旧的列表，避免旧数据闪烁
    modelOptions.value = []
    const res: any = await fetchOpenAIModels({
      id: keyConfig.value.id,
      key: keyConfig.value.key,
      apiBaseUrl: keyConfig.value.apiBaseUrl,
    })
    const models: string[] = (res?.data as any) || []
    if (!models.length) {
      ms.warning('未拉取到模型或拉取失败')
      return
    }
    // 覆盖下拉选项为新列表，保持选中值在新列表中
    const options = models.map(m => ({ label: m, key: m, value: m }))
    modelOptions.value = options
    keyConfig.value.availableModels = models
    // 命名空间缓存：按 apiKey + baseUrl 存储独立的模型列表
    const ns = buildModelsNamespace(keyConfig.value.key, keyConfig.value.apiBaseUrl)
    if (ns)
      setModelsCache(ns, options)
    keyConfig.value.chatModels = (keyConfig.value.chatModels || []).filter((m: string) => models.includes(m))
    ms.success(`已刷新模型列表（${models.length}）`)
    // 刷新成功后同步全局会话（仅更新全局，不覆盖本地下拉）
    // 这样可以保证当前编辑界面的下拉立即展示刚拉取到的模型，
    // 同时聊天页会基于新的会话数据更新其下拉选项。
    try {
      await authStore.getSession()
    }
    catch (e) {
      // 会话刷新失败不影响当前页面使用刚刷新出的 options
    }
  }
  catch (e: any) {
    ms.error(e?.message || String(e))
  }
  finally {
    const elapsed = Date.now() - t0
    const wait = MIN_SPIN_MS - elapsed
    if (wait > 0)
      await new Promise(resolve => setTimeout(resolve, wait))
    refreshingModels.value = false
  }
}

const keys = ref([])
const columns = [
  {
    title: t('setting.key'),
    key: 'key',
    resizable: true,
    width: 200,
    minWidth: 100,
    maxWidth: 200,
    ellipsis: true,
  },
  {
    title: t('setting.apiBaseUrl'),
    key: 'apiBaseUrl',
    width: 220,
  },
  {
    title: t('setting.chatModels'),
    key: 'chatModels',
    width: 320,
    render(row: any) {
      const tags = row.chatModels.map((chatModel: string) => {
        return h(
          NTag,
          {
            style: {
              marginRight: '6px',
              marginBottom: '4px',
              cursor: 'copy',
            },
            type: 'info',
            bordered: false,
            title: '点击复制模型名',
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              copyModelName(chatModel)
            },
          },
          {
            default: () => chatModel,
          },
        )
      })
      return tags
    },
  },
  {
    title: t('setting.userRoles'),
    key: 'userRoles',
    width: 200,
    render(row: any) {
      const tags = row.userRoles.map((userRole: UserRole) => {
        return h(
          NTag,
          {
            style: {
              marginRight: '6px',
            },
            type: 'info',
            bordered: false,
          },
          {
            default: () => UserRole[userRole],
          },
        )
      })
      return tags
    },
  },
  {
    title: t('setting.status'),
    key: 'status',
    width: 150,
    render(row: any) {
      return h(
        NTag,
        {
          style: {
            marginRight: '6px',
          },
          type: 'info',
          bordered: false,
        },
        {
          default: () => row.status === Status.Disabled ? '未启用' : '启用',
        },
      )
    },
  },
  {
    title: t('common.action'),
    key: 'id',
    width: 220,
    render(row: KeyConfig) {
      const actions: any[] = []
      actions.push(h(
        NButton,
        {
          size: 'small',
          style: {
            marginRight: '6px',
          },
          type: 'error',
          onClick: () => handleUpdateApiKeyStatus(String(row.id), Status.Deleted),
        },
        { default: () => t('common.delete') },
      ))
      if (row.status === Status.Normal || row.status === Status.Disabled) {
        actions.push(h(
          NButton,
          {
            size: 'small',
            style: {
              marginRight: '6px',
            },
            type: 'info',
            onClick: () => handleEditKey(row),
          },
          { default: () => t('common.edit') },
        ))
      }
      return actions
    },
  },
]
const pagination = reactive({
  page: 1,
  pageSize: 100,
  pageCount: 1,
  itemCount: 1,
  prefix({ itemCount }: { itemCount: number | undefined }) {
    return `Total is ${itemCount}.`
  },
  showSizePicker: true,
  pageSizes: [100],
  onChange: (page: number) => {
    pagination.page = page
    handleGetKeys(pagination.page)
  },
  onUpdatePageSize: (pageSize: number) => {
    pagination.pageSize = pageSize
    pagination.page = 1
    handleGetKeys(pagination.page)
  },
})

async function handleGetKeys(page: number) {
  if (loading.value)
    return
  keys.value.length = 0
  loading.value = true
  const size = pagination.pageSize
  const data = (await fetchGetKeys(page, size)).data
  data.keys.forEach((key: never) => {
    keys.value.push(key)
  })
  keyConfig.value = keys.value[0]
  pagination.page = page
  pagination.pageCount = data.total / size + (data.total % size === 0 ? 0 : 1)
  pagination.itemCount = data.total
  loading.value = false
}

async function handleUpdateApiKeyStatus(id: string, status: Status) {
  dialog.warning({
    title: t('chat.deleteKey'),
    content: t('chat.deleteKeyConfirm'),
    positiveText: t('common.yes'),
    negativeText: t('common.no'),
    onPositiveClick: async () => {
      await fetchUpdateApiKeyStatus(id, status)
      ms.info('OK')
      await handleGetKeys(pagination.page)
    },
  })
}

async function handleUpdateKeyConfig() {
  if (!keyConfig.value.key) {
    ms.error('Api key is required')
    return
  }
  handleSaving.value = true
  try {
    await fetchUpsertApiKey(keyConfig.value)
    // 保存成功后刷新会话，确保聊天页的模型下拉（基于 chatModels）立即包含新增模型
    await authStore.getSession()
    await handleGetKeys(pagination.page)
    show.value = false
  }
  catch (error: any) {
    ms.error(error.message)
  }
  handleSaving.value = false
}

function handleNewKey() {
  keyConfig.value = new KeyConfig('', '', [], [], '')
  // 初次编辑或新建默认使用内置全量模型
  modelOptions.value = authStore.session?.allChatModels || []
  show.value = true
}

function handleEditKey(key: KeyConfig) {
  keyConfig.value = key
  // 打开编辑时按 apiKey+baseUrl 读取命名空间缓存；
  // 若命名空间未命中且存在旧版全局缓存，则回退到旧缓存；否则回退到内置全量列表
  const ns = buildModelsNamespace(key.key, key.apiBaseUrl)
  let cached = ns ? getCachedOptions(ns) : null
  if (!cached) {
    const legacy = getCachedOptions('__legacy__')
    if (legacy)
      cached = legacy
  }
  modelOptions.value = cached || authStore.session?.allChatModels || []
  show.value = true
}

onMounted(async () => {
  await handleGetKeys(pagination.page)
})
</script>

<template>
  <div class="p-4 space-y-5 min-h-[300px]">
    <div class="space-y-6">
      <NSpace vertical :size="12">
        <div class="flex justify-end">
          <NButton @click="handleNewKey()">
            {{ $t('setting.addKey') }}
          </NButton>
        </div>
        <NDataTable
          ref="table"
          remote
          :loading="loading"
          :row-key="(rowData) => rowData.id"
          :columns="columns"
          :data="keys"
          :pagination="pagination"
          :max-height="444"
          :scroll-x="1500"
          striped @update:page="handleGetKeys"
        />
      </NSpace>
    </div>
  </div>

  <NModal v-model:show="show" :auto-focus="false" preset="card" :style="{ width: !isMobile ? '50%' : '100%' }">
    <div class="p-4 space-y-5 min-h-[200px]">
      <div class="space-y-6">
        <div class="flex items-center space-x-4">
          <span class="flex-shrink-0 w-[100px]">{{ $t('setting.api') }}</span>
          <div class="flex-1">
            <NInput
              v-model:value="keyConfig.key" type="textarea"
              :autosize="{ minRows: 3, maxRows: 4 }" placeholder=""
            />
          </div>
        </div>
        <div class="flex items-center space-x-4">
          <span class="flex-shrink-0 w-[100px]">{{ $t('setting.apiBaseUrl') }}</span>
          <div class="flex-1">
            <NInput
              v-model:value="keyConfig.apiBaseUrl" type="textarea"
              :autosize="{ minRows: 1, maxRows: 2 }" placeholder=""
            />
          </div>
        </div>
        <div class="flex items-center space-x-4">
          <span class="flex-shrink-0 w-[100px]">{{ $t('setting.chatModels') }}</span>
          <div class="flex-1">
            <div class="flex items-center space-x-2">
              <NSelect
                style="width: 100%"
                multiple
                filterable
                :filter="filterSelectOption"
                :value="keyConfig.chatModels"
                :options="modelOptions"
                :render-tag="renderModelTag"
                @update-value="value => keyConfig.chatModels = value"
              />
              <NButton
                class="justify-center min-w-[72px]"
                type="primary"
                :disabled="!keyConfig.key || refreshingModels"
                @click="handleRefreshModels"
              >
                <template v-if="refreshingModels">
                  <span class="inline-flex items-center justify-center w-full">
                    <span class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  </span>
                </template>
                <template v-else>
                  {{ $t('common.refresh') || '刷新' }}
                </template>
              </NButton>
            </div>
          </div>
        </div>
        <div class="flex items-center space-x-4">
          <span class="flex-shrink-0 w-[100px]">{{ $t('setting.userRoles') }}</span>
          <div class="flex-1">
            <NSelect
              style="width: 100%"
              multiple
              :value="keyConfig.userRoles"
              :options="userRoleOptions"
              @update-value="value => keyConfig.userRoles = value"
            />
          </div>
        </div>
        <div class="flex items-center space-x-4">
          <span class="flex-shrink-0 w-[100px]">{{ $t('setting.status') }}</span>
          <div class="flex-1">
            <NSwitch
              :round="false"
              :value="keyConfig.status === Status.Normal"
              @update:value="(val) => { keyConfig.status = val ? Status.Normal : Status.Disabled }"
            />
          </div>
        </div>
        <div class="flex items-center space-x-4">
          <span class="flex-shrink-0 w-[100px]" />
          <NButton type="primary" :loading="handleSaving" @click="handleUpdateKeyConfig()">
            {{ $t('common.save') }}
          </NButton>
        </div>
      </div>
    </div>
  </NModal>
</template>
