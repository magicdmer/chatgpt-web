import { generateImageTool } from './generate_image'
import type { ToolPlugin } from './types'

export const plugins: ToolPlugin[] = [
  generateImageTool,
]

export const getToolsForOpenAI = () => {
  return plugins.map(plugin => ({
    type: 'function',
    function: {
      name: plugin.name,
      description: plugin.description,
      parameters: plugin.parameters,
    },
  }))
}

export const getPluginByName = (name: string) => {
  return plugins.find(plugin => plugin.name === name)
}
