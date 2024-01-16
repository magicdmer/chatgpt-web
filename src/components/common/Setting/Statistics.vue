<script setup lang='ts'>
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { NCol, NDatePicker, NIcon, NNumberAnimation, NRow, NSelect, NSpin, NStatistic } from 'naive-ui'
import type { ChartData, ChartOptions } from 'chart.js'
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Title, Tooltip } from 'chart.js'
import { Bar } from 'vue-chartjs'
import dayjs from 'dayjs'
import type { UserOption } from './model'
import { t } from '@/locales'
import { fetchGetAllUserOption, fetchUserStatistics } from '@/api'
import { SvgIcon } from '@/components/common'
import { useUserStore } from '@/store'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale)

const userStore = useUserStore()
const selectedUser = ref('')

const tempOptions = ref<UserOption[]>([])

const userOptions = computed(() => {
  return tempOptions.value.map((user: UserOption) => ({
    value: user._id || '',
    key: user.email || '',
    label: user.remark ? user.remark : user.email,
  }))
})

const chartData: ChartData<'bar'> = reactive({
  labels: [],
  datasets: [
    {
      label: t('setting.statisticsPrompt'),
      data: [],
      borderColor: '#a1dc95',
      backgroundColor: '#a1dc95',
      stack: 'Usage',
    },
    {
      label: t('setting.statisticsCompletion'),
      data: [],
      borderColor: '#6d6e7e',
      backgroundColor: '#6d6e7e',
      stack: 'Usage',
    },
  ],
})
const chartOptions: ChartOptions<'bar'> = {
  responsive: true,
}
const summary = ref({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
})
const loading = ref(false)
const range: any = ref([
  dayjs().subtract(30, 'day').startOf('day').valueOf(),
  dayjs().endOf('day').valueOf(),
])
const rangeShortcuts: { [index: string]: [number, number] } = {}
// last month
rangeShortcuts[t('setting.statisticsPeriodLastMonth')] = [
  dayjs().subtract(1, 'month').startOf('month').valueOf(),
  dayjs().subtract(1, 'month').endOf('month').valueOf(),
]
// current month
rangeShortcuts[t('setting.statisticsPeriodCurrentMonth')] = [
  dayjs().startOf('month').valueOf(),
  dayjs().endOf('month').valueOf(),
]
// last 30 days
rangeShortcuts[t('setting.statisticsPeriodLast30Days')] = [
  dayjs().subtract(30, 'day').startOf('day').valueOf(),
  dayjs().endOf('day').valueOf(),
]

const showChart = ref(true)

async function fetchStatistics() {
  try {
    loading.value = true

    const { data } = await fetchUserStatistics(
      selectedUser.value,
      dayjs(range.value[0]).startOf('day').valueOf(),
      dayjs(range.value[1]).endOf('day').valueOf(),
    )

    if (Object.keys(data.chartData).length) {
      summary.value.promptTokens = data.promptTokens
      summary.value.completionTokens = data.completionTokens
      summary.value.totalTokens = data.totalTokens

      chartData.labels = data.chartData.map((item: any) => item._id)
      chartData.datasets[0].data = data.chartData.map((item: any) => item.promptTokens)
      chartData.datasets[1].data = data.chartData.map((item: any) => item.completionTokens)

      // todo: don't know why data change won't trigger chart re-render, dirty hack
      showChart.value = false
      nextTick(() => {
        showChart.value = true
      })
    }
  }
  finally {
    loading.value = false
  }
}

async function fetchUserUsageStatistics(value: string) {
  selectedUser.value = value
  fetchStatistics()
}

async function fetchUserOptions() {
  const data = (await fetchGetAllUserOption()).data
  tempOptions.value = data as UserOption[]
}

onMounted(() => {
  fetchUserOptions()
  fetchStatistics()
})
</script>

<template>
  <NSpin :show="loading">
    <div class="p-4 space-y-5 min-h-[200px]">
      <div class="space-y-6">
        <div class="flex items-center space-x-4">
          <span v-if="userStore.userInfo.root" class="flex-shrink-0 w-[100px]">{{ $t('setting.statisticsUser') }}</span>
          <div v-if="userStore.userInfo.root" class="flex-1">
            <NSelect
              style="width: 240px"
              :value="selectedUser"
              :options="userOptions"
              @update-value="value => fetchUserUsageStatistics(value)"
            />
          </div>
          <span class="flex-shrink-0 w-[100px]">{{ $t('setting.statisticsPeriod') }}</span>
          <div class="flex-1">
            <NDatePicker
              v-model:value="range"
              type="daterange"
              :shortcuts="rangeShortcuts"
              @update:value="fetchStatistics"
            />
          </div>
        </div>

        <div class="flex items-center space-x-4">
          <NRow>
            <NCol :span="8" class="text-center">
              <NStatistic :label="t('setting.statisticsPrompt')">
                <template #prefix>
                  <NIcon>
                    <SvgIcon class="text-lg" icon="ri-chat-upload-line" />
                  </NIcon>
                </template>
                <NNumberAnimation :duration="1000" :to="summary.promptTokens" />
              </NStatistic>
            </NCol>
            <NCol :span="8" class="text-center">
              <NStatistic :label="t('setting.statisticsCompletion')">
                <template #prefix>
                  <NIcon>
                    <SvgIcon class="text-lg" icon="ri-chat-download-line" />
                  </NIcon>
                </template>
                <NNumberAnimation :duration="1000" :to="summary.completionTokens" />
              </NStatistic>
            </NCol>
            <NCol :span="8" class="text-center">
              <NStatistic :label="t('setting.statisticsTotal')">
                <template #prefix>
                  <NIcon>
                    <SvgIcon class="text-lg" icon="ri-question-answer-line" />
                  </NIcon>
                </template>
                <NNumberAnimation :duration="1000" :to="summary.totalTokens" />
              </NStatistic>
            </NCol>
          </NRow>
        </div>

        <Bar
          v-if="showChart && chartData.labels?.length"
          ref="statisticsChart"
          style="aspect-ratio: 3/2;"
          :options="chartOptions"
          :data="chartData"
        />
      </div>
    </div>
  </NSpin>
</template>

<style>

</style>
