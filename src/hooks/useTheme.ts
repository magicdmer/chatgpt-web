import type { GlobalThemeOverrides } from 'naive-ui'
import { computed, watch } from 'vue'
import { darkTheme, useOsTheme } from 'naive-ui'
import { useAppStore } from '@/store'

export function useTheme() {
  const appStore = useAppStore()

  const OsTheme = useOsTheme()

  const isDark = computed(() => {
    if (appStore.theme === 'auto')
      return OsTheme.value === 'dark'
    else
      return appStore.theme === 'dark'
  })

  const theme = computed(() => {
    return isDark.value ? darkTheme : undefined
  })

  const themeOverrides = computed<GlobalThemeOverrides>(() => {
    const common = {
      primaryColor: '#4f46e5',
      primaryColorHover: '#6366f1',
      primaryColorPressed: '#4338ca',
      primaryColorSuppl: '#6366f1',
      borderRadius: '8px',
      borderRadiusSmall: '6px',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    }

    if (isDark.value) {
      return {
        common: {
          ...common,
          bodyColor: '#1a1a1a',
          cardColor: '#1e1e1e',
          modalColor: '#1e1e1e',
          popoverColor: '#262626',
          tableColor: '#1e1e1e',
          inputColor: '#262626',
        },
        Button: {
          borderRadiusMedium: '8px',
          borderRadiusSmall: '6px',
          borderRadiusLarge: '10px',
        },
        Input: {
          borderRadius: '8px',
        },
      }
    }
    return {
      common: {
        ...common,
      },
      Button: {
        borderRadiusMedium: '8px',
        borderRadiusSmall: '6px',
        borderRadiusLarge: '10px',
      },
      Input: {
        borderRadius: '8px',
      },
    }
  })

  watch(
    () => isDark.value,
    (dark) => {
      if (dark)
        document.documentElement.classList.add('dark')
      else
        document.documentElement.classList.remove('dark')
    },
    { immediate: true },
  )

  return { theme, themeOverrides }
}
