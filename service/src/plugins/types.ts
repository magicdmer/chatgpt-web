import type { BasePlugin } from '@chatgpt-web/plugin-sdk'
import type { ValidateFunction } from 'ajv'

export type PluginSettingType = 'string' | 'text' | 'int' | 'float' | 'boolean' | 'list' | 'select' | 'model'

export interface PluginSettingDefinition {
  description: string
  type: PluginSettingType
  hint?: string
  obvious_hint?: boolean
  default: unknown
  required?: boolean
  secret?: boolean
  placeholder?: string
  min?: number
  max?: number
  pattern?: string
  item_type?: 'string' | 'int' | 'float'
  options?: Array<{ label: string; value: string | number }>
}

export interface PluginManifest {
  manifestVersion: 1
  apiVersion: 1
  id: string
  name: string
  version: string
  description: string
  author?: string
  entry: string
  settings: Record<string, PluginSettingDefinition>
}

export interface LoadedTool {
  pluginId: string
  name: string
  description: string
  parameters: Record<string, any>
  validate: ValidateFunction
  execute: (args: Record<string, any>, context: any) => Promise<string>
}

export interface LoadedPlugin {
  manifest: PluginManifest
  instance: BasePlugin
  tools: LoadedTool[]
}

export interface PluginLoadError {
  directory: string
  id?: string
  name?: string
  message: string
}

export interface PluginListItem {
  id: string
  name: string
  version: string
  description: string
  author?: string
  published: boolean
  enabled: boolean
  tools: Array<{ name: string; description: string }>
  settings?: Record<string, any>
  settingsSchema?: Record<string, PluginSettingDefinition>
  configuredSecrets?: string[]
  loadError?: string
}
