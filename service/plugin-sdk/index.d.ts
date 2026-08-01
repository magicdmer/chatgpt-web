export interface LlmToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
}

export interface PluginLogger {
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

export interface PluginStorage {
  get<T>(key: string, scope?: 'global' | 'user'): Promise<T | null>
  set<T>(key: string, value: T, scope?: 'global' | 'user'): Promise<void>
  delete(key: string, scope?: 'global' | 'user'): Promise<void>
}

export interface PluginContext {
  pluginId: string
  user: { id: string, root: boolean }
  settings: Readonly<Record<string, any>>
  signal: AbortSignal
  logger: PluginLogger
  storage: PluginStorage
  services: {
    images: {
      generate(input: { prompt: string, model: string }): Promise<string>
    }
  }
}

export interface RegisteredTool extends LlmToolDefinition {
  methodName: string
  execute(args: Record<string, any>, context: PluginContext): Promise<string>
}

export declare function llmTool(definition: LlmToolDefinition): MethodDecorator

export declare abstract class BasePlugin {
  getTools(): RegisteredTool[]
}

export declare function isBasePluginClass(value: unknown): value is new () => BasePlugin
