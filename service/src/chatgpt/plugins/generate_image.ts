import axios from 'axios'
import type { ToolPlugin } from './types'
import { getPluginConfig } from '../../storage/sqlite'

async function draw(url: string, key: string, prompt: string, model: string): Promise<string> {
  let jsondata = {}
  if (model === 'dall-e-2') {
    jsondata = {
      model,
      prompt,
      n: 1,
      size: '512x512',
    }
  }
  else {
    jsondata = {
      model,
      prompt,
      n: 1,
      size: '1024x1024',
    }
  }

  try {
    const response = await axios.post(url, jsondata, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
    })

    const imageUrl = `![我的图片](${response.data.data[0].url})`
    return imageUrl
  }
  catch (error) {
    console.error(error)
    throw error
  }
}

async function mg_draw(url: string, key: string, prompt: string, model: string): Promise<string> {
  const payload = {
    model,
    prompt
  }

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'api-key': key,
      },
    })

    if (response.data?.code !== 0) {
      throw new Error('Image generation failed')
    }

    const imageUrl = response.data.image
    if (!imageUrl) {
      throw new Error('No image URL in response')
    }

    return `![我的图片](${imageUrl})`
  }
  catch (error) {
    console.error(error)
    throw error
  }
}

export const generateImageTool: ToolPlugin = {
  name: 'generate_image',
  description: 'Generate an image based on a text prompt.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The text prompt to generate the image from.',
      },
    },
    required: ['prompt'],
  },
  execute: async (args, context) => {
    const { prompt } = args
    const { key, mgApiKey, mgApiUrl } = context

    // Fetch the specific model configured for this plugin, default to dall-e-3
    const config = await getPluginConfig('generate_image')
    const imageModel = config?.settings?.model || 'dall-e-3'

    if (mgApiKey && mgApiUrl) {
      return await mg_draw(`${mgApiUrl}/private/ai_draw`, mgApiKey, prompt, imageModel)
    }
    else {
      return await draw(`${key.apiBaseUrl}/v1/images/generations`, key.key, prompt, imageModel)
    }
  },
}
