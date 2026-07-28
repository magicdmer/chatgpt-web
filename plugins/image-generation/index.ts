import { BasePlugin, llmTool } from '@chatgpt-web/plugin-sdk'
import type { PluginContext } from '@chatgpt-web/plugin-sdk'

interface GenerateImageArgs {
  prompt: string
}

export default class ImageGenerationPlugin extends BasePlugin {
  @llmTool({
    name: 'generate_image',
    description: 'Generate an image based on a text prompt.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The text prompt used to generate the image.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  })
  async generateImage(args: GenerateImageArgs, context: PluginContext): Promise<string> {
    return await context.services.images.generate({
      prompt: args.prompt,
      model: String(context.settings.model || 'dall-e-3'),
    })
  }
}
