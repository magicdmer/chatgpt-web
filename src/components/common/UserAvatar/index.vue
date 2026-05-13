<script setup lang='ts'>
import { computed, onMounted, ref } from 'vue'
import { NAvatar, NButton, NTag, NTooltip } from 'naive-ui'
import { useRoute } from 'vue-router'
import { UserRole } from '../Setting/model'
import { useAuthStore, useUserStore } from '@/store'
import defaultAvatar from '@/assets/avatar.jpg'
import { isString } from '@/utils/is'
import Permission from '@/views/chat/layout/Permission.vue'
import { useBasicLayout } from '@/hooks/useBasicLayout'

const route = useRoute()
const userStore = useUserStore()
const authStore = useAuthStore()
const { isMobile } = useBasicLayout()
const showPermission = ref(false)

const needPermission = computed(() => !!authStore.session?.auth && !authStore.token && (isMobile.value || showPermission.value))

const userInfo = computed(() => userStore.userInfo)

onMounted(async () => {
  const sign = route.query.verifyresetpassword as string
  if (sign)
    showPermission.value = true
})
</script>

<template>
  <div class="flex items-center overflow-hidden">
    <div class="w-10 h-10 overflow-hidden rounded-full shrink-0" style="border: 1px solid var(--border-default);">
      <template v-if="isString(userInfo.avatar) && userInfo.avatar.length > 0">
        <NAvatar
          size="large"
          round
          :src="userInfo.avatar"
          :fallback-src="defaultAvatar"
        />
      </template>
      <template v-else>
        <NAvatar size="large" round :src="defaultAvatar" />
      </template>
    </div>
    <div class="flex-1 min-w-0 ml-3">
      <div v-if="userInfo.name" class="flex flex-col items-start gap-1 w-full overflow-hidden">
        <NTooltip placement="top" trigger="hover">
          <template #trigger>
            <h2 class="text-sm font-semibold truncate w-full" style="color: var(--text-primary)">
              {{ userInfo.name }}
            </h2>
          </template>
          {{ userInfo.name }}
        </NTooltip>
        <NTag v-if="userInfo.roles.length > 0" size="small" :bordered="false" style="background: var(--surface-hover); color: var(--brand-primary); border-radius: 4px; font-weight: 500;">
          {{ UserRole[userInfo.roles[0]] }}
        </NTag>
      </div>
      <p v-if="userInfo.name" class="overflow-hidden text-xs text-ellipsis whitespace-nowrap mt-0.5" style="color: var(--text-muted)">
        <span
          v-if="isString(userInfo.description) && userInfo.description !== ''"
          v-html="userInfo.description"
        />
      </p>
      <NButton
        v-else tag="a" text
        @click="showPermission = true"
      >
        <span v-if="!!authStore.session?.auth && !authStore.token" class="text-[15px] font-semibold" style="color: var(--text-primary)">
          {{ $t('common.notLoggedIn') }}
        </span>
        <span v-else class="text-[15px] font-semibold" style="color: var(--text-primary)">
          {{ authStore.session?.title }}
        </span>
      </NButton>
    </div>
    <Permission :visible="needPermission" @update:visible="(newValue) => showPermission = newValue" />
  </div>
</template>
