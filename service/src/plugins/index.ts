import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import Ajv from 'ajv'
import { isBasePluginClass } from '@chatgpt-web/plugin-sdk'
import type { BasePlugin, PluginContext, RegisteredTool } from '@chatgpt-web/plugin-sdk'
import type { UserInfo } from '../storage/model'
import { UserRole } from '../storage/model'
import {
  deletePluginStorageValue,
  getEnabledPluginIds,
  getPluginConfig,
  getPluginStorageValue,
  initializePluginStorage,
  setPluginStorageValue,
  syncPluginConfig,
  updatePluginConfig,
  updatePluginPublished,
  updateUserPluginEnabled,
} from '../storage/sqlite'
import { createPluginServices } from './services'
import type {
  LoadedPlugin,
  LoadedTool,
  PluginListItem,
  PluginLoadError,
  PluginManifest,
  PluginSettingDefinition,
} from './types'

const ajv = new Ajv({ allErrors: true, strict: false })
const loadedPlugins = new Map<string, LoadedPlugin>()
const loadErrors: PluginLoadError[] = []
let initializationPromise: Promise<void> | null = null
let loadGeneration = 0
// Keep the import expression native so tsup does not bundle external plugin entry files.
// eslint-disable-next-line no-new-func
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getPluginDirectory(): string {
  if (process.env.PLUGIN_DIR)
    return path.resolve(process.env.PLUGIN_DIR)
  const cwdDirectory = path.resolve(process.cwd(), 'plugins')
  if (fs.existsSync(cwdDirectory))
    return cwdDirectory
  return path.resolve(process.cwd(), '../plugins')
}

function validateSettingValue(key: string, definition: PluginSettingDefinition, value: unknown): void {
  const fail = (message: string) => {
    throw new Error(`设置项 ${key}: ${message}`)
  }

  switch (definition.type) {
    case 'string':
    case 'text':
    case 'model':
      if (typeof value !== 'string')
        fail('必须是字符串')
      if (definition.required && (value as string).trim().length === 0)
        fail('不能为空')
      if (definition.pattern && !new RegExp(definition.pattern).test(value as string))
        fail('格式不正确')
      break
    case 'int':
      if (!Number.isInteger(value))
        fail('必须是整数')
      break
    case 'float':
      if (typeof value !== 'number' || !Number.isFinite(value))
        fail('必须是数字')
      break
    case 'boolean':
      if (typeof value !== 'boolean')
        fail('必须是布尔值')
      break
    case 'list':
      if (!Array.isArray(value))
        fail('必须是列表')
      if (definition.item_type === 'string' && (value as unknown[]).some(item => typeof item !== 'string'))
        fail('列表项必须是字符串')
      if (definition.item_type === 'int' && (value as unknown[]).some(item => !Number.isInteger(item)))
        fail('列表项必须是整数')
      if (definition.item_type === 'float' && (value as unknown[]).some(item => typeof item !== 'number' || !Number.isFinite(item)))
        fail('列表项必须是数字')
      break
    case 'select': {
      const values = (definition.options || []).map(option => option.value)
      if (!values.includes(value as never))
        fail('不在可选范围内')
      break
    }
    default:
      fail(`不支持的类型 ${String(definition.type)}`)
  }

  if (typeof value === 'number') {
    if (definition.min !== undefined && value < definition.min)
      fail(`不能小于 ${definition.min}`)
    if (definition.max !== undefined && value > definition.max)
      fail(`不能大于 ${definition.max}`)
  }
}

function validateSettingDefinition(key: string, value: unknown): asserts value is PluginSettingDefinition {
  if (!isRecord(value) || typeof value.description !== 'string' || typeof value.type !== 'string' || !('default' in value))
    throw new Error(`设置项 ${key} 定义不完整`)
  validateSettingValue(key, value as PluginSettingDefinition, value.default)
}

function parseManifest(raw: unknown): PluginManifest {
  if (!isRecord(raw))
    throw new Error('plugin.json 必须是 JSON 对象')
  if (raw.manifestVersion !== 1)
    throw new Error(`不支持的 manifestVersion: ${String(raw.manifestVersion)}`)
  if (raw.apiVersion !== 1)
    throw new Error(`不支持的 apiVersion: ${String(raw.apiVersion)}`)
  if (typeof raw.id !== 'string' || !/^[0-9a-f]{32}$/.test(raw.id))
    throw new Error('插件 id 必须是 32 位小写十六进制 GUID')
  if (typeof raw.name !== 'string' || !raw.name.trim())
    throw new Error('插件 name 不能为空')
  if (typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(raw.version))
    throw new Error('插件 version 必须是语义化版本')
  if (typeof raw.description !== 'string' || typeof raw.entry !== 'string')
    throw new Error('插件 description 和 entry 必须是字符串')
  if (!isRecord(raw.settings))
    throw new Error('插件 settings 必须是对象')
  for (const [key, definition] of Object.entries(raw.settings))
    validateSettingDefinition(key, definition)
  return raw as PluginManifest
}

function getDefaultSettings(manifest: PluginManifest): Record<string, any> {
  return Object.fromEntries(Object.entries(manifest.settings).map(([key, definition]) => [key, definition.default]))
}

function mergeEffectiveSettings(manifest: PluginManifest, saved: Record<string, any>): Record<string, any> {
  const settings: Record<string, any> = {}
  for (const [key, definition] of Object.entries(manifest.settings)) {
    const value = Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : definition.default
    try {
      validateSettingValue(key, definition, value)
      settings[key] = value
    }
    catch {
      settings[key] = definition.default
    }
  }
  return settings
}

function validateSettingsForSave(manifest: PluginManifest, incoming: unknown, current: Record<string, any>): Record<string, any> {
  if (!isRecord(incoming))
    throw new Error('插件设置必须是对象')
  const unknownKeys = Object.keys(incoming).filter(key => !manifest.settings[key])
  if (unknownKeys.length > 0)
    throw new Error(`未知设置项: ${unknownKeys.join(', ')}`)

  const result: Record<string, any> = {}
  for (const [key, definition] of Object.entries(manifest.settings)) {
    let value = Object.prototype.hasOwnProperty.call(incoming, key) ? incoming[key] : current[key]
    if (definition.secret && value === '' && current[key])
      value = current[key]
    if (value === undefined)
      value = definition.default
    validateSettingValue(key, definition, value)
    result[key] = value
  }
  return result
}

async function loadPlugin(directory: string, manifest: PluginManifest, generation: number): Promise<LoadedPlugin> {
  const entryPath = path.resolve(directory, manifest.entry)
  const relativeEntry = path.relative(directory, entryPath)
  if (relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry) || path.extname(entryPath) !== '.ts')
    throw new Error('entry 必须是插件目录内的 TypeScript 文件')
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile())
    throw new Error(`插件入口不存在: ${manifest.entry}`)

  const entryUrl = pathToFileURL(entryPath)
  entryUrl.searchParams.set('generation', String(generation))
  const module = await dynamicImport(entryUrl.href)
  // tsx may expose a CommonJS-transpiled TypeScript default export as
  // module.default.default when it is loaded from the bundled server.
  const PluginClass = module.default?.default ?? module.default
  if (!isBasePluginClass(PluginClass))
    throw new Error('插件默认导出必须是 BasePlugin 子类')
  const instance = new PluginClass() as BasePlugin
  const registeredTools = instance.getTools() as RegisteredTool[]
  if (registeredTools.length === 0)
    throw new Error('插件至少需要一个 @llmTool 方法')

  const names = new Set<string>()
  const tools: LoadedTool[] = registeredTools.map((tool) => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name))
      throw new Error(`工具名格式非法: ${tool.name}`)
    if (names.has(tool.name))
      throw new Error(`插件内部工具名重复: ${tool.name}`)
    if (!tool.description || !isRecord(tool.parameters))
      throw new Error(`工具 ${tool.name} 的描述或参数 Schema 无效`)
    names.add(tool.name)
    return {
      pluginId: manifest.id,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      validate: ajv.compile(tool.parameters),
      execute: tool.execute,
    }
  })
  return { manifest, instance, tools }
}

async function loadPlugins(): Promise<void> {
  await initializePluginStorage()
  const nextLoadedPlugins = new Map<string, LoadedPlugin>()
  const nextLoadErrors: PluginLoadError[] = []
  const generation = ++loadGeneration

  const pluginDirectory = getPluginDirectory()
  if (!fs.existsSync(pluginDirectory)) {
    globalThis.console.warn(`Plugin directory does not exist: ${pluginDirectory}`)
    loadedPlugins.clear()
    loadErrors.length = 0
    return
  }

  const candidates: Array<{ directory: string; manifest: PluginManifest }> = []
  const directories = fs.readdirSync(pluginDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(pluginDirectory, entry.name))
    .sort()

  for (const directory of directories) {
    const manifestPath = path.join(directory, 'plugin.json')
    if (!fs.existsSync(manifestPath))
      continue
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      candidates.push({ directory, manifest: parseManifest(raw) })
    }
    catch (error: any) {
      nextLoadErrors.push({ directory, message: error?.message || String(error) })
    }
  }

  const duplicateIds = new Set<string>()
  const idCounts = new Map<string, number>()
  for (const candidate of candidates)
    idCounts.set(candidate.manifest.id, (idCounts.get(candidate.manifest.id) || 0) + 1)
  for (const [id, count] of idCounts) {
    if (count > 1)
      duplicateIds.add(id)
  }

  for (const { directory, manifest } of candidates) {
    if (duplicateIds.has(manifest.id)) {
      nextLoadErrors.push({ directory, id: manifest.id, name: manifest.name, message: `插件 ID 重复: ${manifest.id}` })
      continue
    }
    try {
      const plugin = await loadPlugin(directory, manifest, generation)
      nextLoadedPlugins.set(manifest.id, plugin)
      await syncPluginConfig(manifest.id, manifest.name, getDefaultSettings(manifest))
      globalThis.console.log(`Loaded plugin: ${manifest.name} (${manifest.id})`)
    }
    catch (error: any) {
      nextLoadErrors.push({ directory, id: manifest.id, name: manifest.name, message: error?.message || String(error) })
      globalThis.console.error(`Failed to load plugin ${manifest.name}:`, error)
    }
  }

  loadedPlugins.clear()
  for (const [id, plugin] of nextLoadedPlugins)
    loadedPlugins.set(id, plugin)
  loadErrors.splice(0, loadErrors.length, ...nextLoadErrors)
}

export function initializePlugins(): Promise<void> {
  if (initializationPromise)
    return initializationPromise
  initializationPromise = loadPlugins().finally(() => {
    initializationPromise = null
  })
  return initializationPromise
}

function isAdmin(user: UserInfo): boolean {
  return Boolean(user.roles?.includes(UserRole.Admin))
}

async function resolveEnabledPlugins(user: UserInfo): Promise<LoadedPlugin[]> {
  const userId = String(user.id)
  const enabledIds = new Set(await getEnabledPluginIds(userId))
  const result: LoadedPlugin[] = []
  for (const pluginId of enabledIds) {
    const plugin = loadedPlugins.get(pluginId)
    if (!plugin)
      continue
    const config = await getPluginConfig(pluginId)
    if (config && (isAdmin(user) || config.published))
      result.push(plugin)
  }
  return result
}

export async function getPluginListForUser(user: UserInfo): Promise<PluginListItem[]> {
  const enabledIds = new Set(await getEnabledPluginIds(String(user.id)))
  const admin = isAdmin(user)
  const items: PluginListItem[] = []

  for (const plugin of loadedPlugins.values()) {
    const config = await getPluginConfig(plugin.manifest.id)
    if (!config || (!admin && !config.published))
      continue
    const effectiveSettings = mergeEffectiveSettings(plugin.manifest, config.settings)
    const configuredSecrets = Object.entries(plugin.manifest.settings)
      .filter(([key, definition]) => definition.secret && Boolean(effectiveSettings[key]))
      .map(([key]) => key)
    const publicSettings = Object.fromEntries(Object.entries(effectiveSettings).map(([key, value]) => [
      key,
      plugin.manifest.settings[key]?.secret ? '' : value,
    ]))

    items.push({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      author: plugin.manifest.author,
      published: config.published,
      enabled: enabledIds.has(plugin.manifest.id),
      tools: plugin.tools.map(tool => ({ name: tool.name, description: tool.description })),
      ...(admin
        ? {
            settings: publicSettings,
            settingsSchema: plugin.manifest.settings,
            configuredSecrets,
          }
        : {}),
    })
  }

  if (admin) {
    for (const error of loadErrors) {
      if (!error.id || items.some(item => item.id === error.id))
        continue
      items.push({
        id: error.id,
        name: error.name || path.basename(error.directory),
        version: '',
        description: '',
        published: false,
        enabled: false,
        tools: [],
        loadError: error.message,
      })
    }
  }
  return items.sort((left, right) => left.name.localeCompare(right.name))
}

export async function setPluginEnabledForUser(user: UserInfo, pluginId: string, enabled: boolean): Promise<void> {
  const plugin = loadedPlugins.get(pluginId)
  if (!plugin)
    throw new Error('插件不存在或加载失败')
  const config = await getPluginConfig(pluginId)
  if (!config || (!isAdmin(user) && !config.published))
    throw new Error('当前用户无权使用该插件')

  if (enabled) {
    const currentPlugins = await resolveEnabledPlugins(user)
    const currentToolOwners = new Map<string, string>()
    for (const current of currentPlugins) {
      if (current.manifest.id === pluginId)
        continue
      for (const tool of current.tools)
        currentToolOwners.set(tool.name, current.manifest.name)
    }
    for (const tool of plugin.tools) {
      const owner = currentToolOwners.get(tool.name)
      if (owner)
        throw new Error(`无法启用，工具 ${tool.name} 与插件“${owner}”重复`)
    }
  }

  await updateUserPluginEnabled(String(user.id), pluginId, enabled)
}

export async function setPluginPublished(pluginId: string, published: boolean): Promise<void> {
  if (!loadedPlugins.has(pluginId))
    throw new Error('插件不存在或加载失败')
  await updatePluginPublished(pluginId, published)
}

export async function savePluginSettings(pluginId: string, incoming: unknown): Promise<void> {
  const plugin = loadedPlugins.get(pluginId)
  if (!plugin)
    throw new Error('插件不存在或加载失败')
  const config = await getPluginConfig(pluginId)
  if (!config)
    throw new Error('插件配置不存在')
  const settings = validateSettingsForSave(plugin.manifest, incoming, mergeEffectiveSettings(plugin.manifest, config.settings))
  await updatePluginConfig(pluginId, settings)
}

export async function getToolsForUser(user: UserInfo) {
  const plugins = await resolveEnabledPlugins(user)
  const names = new Set<string>()
  const tools: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, any> } }> = []
  for (const plugin of plugins) {
    for (const tool of plugin.tools) {
      if (names.has(tool.name))
        throw new Error(`当前已启用插件的工具名冲突: ${tool.name}`)
      names.add(tool.name)
      tools.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })
    }
  }
  return tools
}

export async function resolveToolForUser(user: UserInfo, toolName: string): Promise<{ plugin: LoadedPlugin; tool: LoadedTool } | null> {
  const matches: Array<{ plugin: LoadedPlugin; tool: LoadedTool }> = []
  for (const plugin of await resolveEnabledPlugins(user)) {
    const tool = plugin.tools.find(candidate => candidate.name === toolName)
    if (tool)
      matches.push({ plugin, tool })
  }
  if (matches.length > 1)
    throw new Error(`工具名冲突: ${toolName}`)
  return matches[0] || null
}

function createContext(plugin: LoadedPlugin, user: UserInfo, settings: Record<string, any>, signal: AbortSignal): PluginContext {
  const userId = String(user.id)
  const prefix = `[plugin:${plugin.manifest.id}]`
  const ownerId = (scope: 'global' | 'user') => scope === 'global' ? '' : userId
  return {
    pluginId: plugin.manifest.id,
    user: { id: userId, root: isAdmin(user) },
    settings: Object.freeze({ ...settings }),
    signal,
    logger: {
      info: (message, data) => globalThis.console.info(prefix, message, data ?? ''),
      warn: (message, data) => globalThis.console.warn(prefix, message, data ?? ''),
      error: (message, data) => globalThis.console.error(prefix, message, data ?? ''),
    },
    storage: {
      get: (key, scope = 'user') => getPluginStorageValue(plugin.manifest.id, scope, ownerId(scope), key),
      set: (key, value, scope = 'user') => setPluginStorageValue(plugin.manifest.id, scope, ownerId(scope), key, value),
      delete: (key, scope = 'user') => deletePluginStorageValue(plugin.manifest.id, scope, ownerId(scope), key),
    },
    services: createPluginServices(user, signal),
  }
}

export async function executeToolForUser(user: UserInfo, toolName: string, args: Record<string, any>, signal: AbortSignal): Promise<{ pluginName: string; result: string }> {
  const runtime = await resolveToolForUser(user, toolName)
  if (!runtime)
    throw new Error(`工具不存在或当前用户未启用: ${toolName}`)
  if (!runtime.tool.validate(args))
    throw new Error(`工具参数无效: ${ajv.errorsText(runtime.tool.validate.errors)}`)
  const config = await getPluginConfig(runtime.plugin.manifest.id)
  const settings = mergeEffectiveSettings(runtime.plugin.manifest, config?.settings || {})
  const result = await runtime.tool.execute(args, createContext(runtime.plugin, user, settings, signal))
  if (typeof result !== 'string')
    throw new Error(`工具 ${toolName} 必须返回字符串`)
  return { pluginName: runtime.plugin.manifest.name, result }
}

export function getPluginLoadErrors(): readonly PluginLoadError[] {
  return loadErrors
}
