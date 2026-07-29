import { ss } from '@/utils/storage'

const LOCAL_NAME = 'appSetting'

export type Theme = 'light' | 'dark' | 'auto'

export type Language = 'zh-CN' | 'zh-TW' | 'en-US'

export interface AppState {
  siderCollapsed: boolean
  theme: Theme
  language: Language
  advancedMode: boolean
}

export function defaultSetting(): AppState {
  return { siderCollapsed: false, theme: 'light', language: 'zh-CN', advancedMode: false }
}

export function getLocalSetting(): AppState {
  const localSetting: AppState | undefined = ss.get(LOCAL_NAME)
  const setting = { ...defaultSetting(), ...localSetting }
  if (!['zh-CN', 'zh-TW', 'en-US'].includes(setting.language))
    setting.language = 'zh-CN'
  return setting
}

export function setLocalSetting(setting: AppState): void {
  ss.set(LOCAL_NAME, setting)
}
