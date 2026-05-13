<script setup lang='ts'>
import { defineAsyncComponent, ref } from 'vue'
import { HoverButton, SvgIcon, UserAvatar } from '@/components/common'
import { useAuthStore } from '@/store'
const Setting = defineAsyncComponent(() => import('@/components/common/Setting/index.vue'))

const authStore = useAuthStore()

const show = ref(false)

async function handleLogout() {
  await authStore.removeToken()
}
</script>

<template>
  <footer class="sider-footer">
    <div class="flex-1 flex-shrink-0 overflow-hidden">
      <UserAvatar />
    </div>
    <HoverButton v-if="!!authStore.token" :tooltip="$t('common.logOut')" @click="handleLogout">
      <span class="text-xl" style="color: var(--text-muted)">
        <SvgIcon icon="uil:exit" />
      </span>
    </HoverButton>

    <HoverButton v-if="!!authStore.token" :tooltip="$t('setting.setting')" @click="show = true">
      <span class="text-xl" style="color: var(--text-muted)">
        <SvgIcon icon="ri:settings-4-line" />
      </span>
    </HoverButton>
    <Setting v-if="show" v-model:visible="show" />
  </footer>
</template>

<style scoped>
.sider-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 12px 16px;
  overflow: hidden;
  border-top: 1px solid var(--border-subtle);
}
</style>
