import axios from 'axios'
import type { UserInfo } from '../storage/model'
import { Status } from '../storage/model'
import { getCacheApiKeys, getCacheConfig } from '../storage/config'

function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
}

// 插件的 model 类型设置由管理员全局下发，不继承调用用户的聊天 Key 角色限制。
async function selectPluginModelKey(model: string) {
  const keys = (await getCacheApiKeys())
    .filter(key => key.status !== Status.Disabled)
    .filter((key) => {
      const availableModels = key.availableModels || []
      return availableModels.length > 0
        ? availableModels.includes(model)
        : (key.chatModels || []).includes(model)
    })
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))

  if (keys.length === 0)
    throw new Error(`未找到支持生图模型 ${model} 的 Key`)
  return keys[0]
}

export function createPluginServices(_user: UserInfo, signal: AbortSignal) {
  return {
    images: {
      async generate(input: { prompt: string; model: string }): Promise<string> {
        const prompt = input.prompt.trim()
        const model = input.model.trim()
        if (!prompt)
          throw new Error('生图提示词不能为空')
        if (!model)
          throw new Error('生图模型不能为空')

        const mgApiKey = process.env.MG_API_KEY
        const mgApiUrl = process.env.MG_API_BASE_URL
        if (mgApiKey && mgApiUrl) {
          const response = await axios.post(`${normalizeApiBaseUrl(mgApiUrl)}/private/ai_draw`, {
            model,
            prompt,
          }, {
            headers: {
              'Content-Type': 'application/json',
              'api-key': mgApiKey,
            },
            signal,
          })
          if (response.data?.code !== 0)
            throw new Error(response.data?.message || 'Image generation failed')
          if (!response.data?.image)
            throw new Error('No image URL in response')
          return `![我的图片](${response.data.image})`
        }

        const key = await selectPluginModelKey(model)
        const config = await getCacheConfig()
        const configuredBaseUrl = key.apiBaseUrl || config.apiBaseUrl || ''
        if (!configuredBaseUrl)
          throw new Error('生图 Key 未配置 API Base URL')

        const payload = {
          model,
          prompt,
          n: 1,
          size: model === 'dall-e-2' ? '512x512' : '1024x1024',
        }
        const response = await axios.post(`${normalizeApiBaseUrl(configuredBaseUrl)}/v1/images/generations`, payload, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key.key}`,
          },
          signal,
        })
        const imageUrl = response.data?.data?.[0]?.url
        if (!imageUrl)
          throw new Error('No image URL in response')
        return `![我的图片](${imageUrl})`
      },
    },
  }
}
