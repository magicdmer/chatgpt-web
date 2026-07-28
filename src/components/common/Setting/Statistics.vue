<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NDatePicker, NEmpty, NSelect, NSpin } from 'naive-ui'
import type { ChartData, ChartOptions } from 'chart.js'
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from 'chart.js'
import { Bar } from 'vue-chartjs'
import dayjs from 'dayjs'
import type { UserOption } from './model'
import { t } from '@/locales'
import { fetchGetAllUserOption, fetchUserStatistics } from '@/api'
import { SvgIcon } from '@/components/common'
import { useUserStore } from '@/store'

ChartJS.register(Tooltip, Legend, BarElement, CategoryScale, LinearScale)

interface UsageSummary {
  requestCount: number
  estimatedCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  averageTokens: number
  estimatedRate: number
}

interface DailyUsage {
  id: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requestCount: number
}

interface UserRanking {
  userId: string
  email: string
  remark?: string
  requestCount: number
  totalTokens: number
}

interface ModelUsage {
  model: string
  requestCount: number
  totalTokens: number
}

interface StatisticsResponse {
  summary: UsageSummary
  chartData: DailyUsage[]
  userRanking: UserRanking[]
  modelDistribution: ModelUsage[]
}

const emptySummary = (): UsageSummary => ({
  requestCount: 0,
  estimatedCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  averageTokens: 0,
  estimatedRate: 0,
})

const userStore = useUserStore()
const isAdmin = computed(() => userStore.userInfo.root)
const selectedUser = ref(isAdmin.value ? 'all' : '')
const users = ref<UserOption[]>([])
const loading = ref(false)
const errorMessage = ref('')
const summary = ref<UsageSummary>(emptySummary())
const dailyUsage = ref<DailyUsage[]>([])
const userRanking = ref<UserRanking[]>([])
const modelDistribution = ref<ModelUsage[]>([])

const range = ref<[number, number]>([
  dayjs().subtract(29, 'day').startOf('day').valueOf(),
  dayjs().endOf('day').valueOf(),
])

const rangeShortcuts: Record<string, [number, number]> = {
  [t('setting.statisticsPeriodCurrentMonth')]: [
    dayjs().startOf('month').valueOf(),
    dayjs().endOf('month').valueOf(),
  ],
  [t('setting.statisticsPeriodLastMonth')]: [
    dayjs().subtract(1, 'month').startOf('month').valueOf(),
    dayjs().subtract(1, 'month').endOf('month').valueOf(),
  ],
  [t('setting.statisticsPeriodLast30Days')]: [
    dayjs().subtract(29, 'day').startOf('day').valueOf(),
    dayjs().endOf('day').valueOf(),
  ],
}

const userOptions = computed(() => [
  { value: 'all', label: t('setting.statisticsAllUsers') },
  ...users.value.map(user => ({
    value: String(user.id || ''),
    label: user.remark ? `${user.remark} · ${user.email}` : String(user.email || ''),
  })),
])

const hasUsage = computed(() => summary.value.requestCount > 0)
const maxUserTokens = computed(() => Math.max(...userRanking.value.map(item => item.totalTokens), 1))
const maxModelTokens = computed(() => Math.max(...modelDistribution.value.map(item => item.totalTokens), 1))

const chartData = computed<ChartData<'bar'>>(() => ({
  labels: dailyUsage.value.map(item => dayjs(item.id).format('MM/DD')),
  datasets: [
    {
      label: t('setting.statisticsPrompt'),
      data: dailyUsage.value.map(item => item.promptTokens),
      backgroundColor: '#818cf8',
      borderRadius: 4,
      borderSkipped: false,
      stack: 'tokens',
    },
    {
      label: t('setting.statisticsCompletion'),
      data: dailyUsage.value.map(item => item.completionTokens),
      backgroundColor: '#22d3ee',
      borderRadius: 4,
      borderSkipped: false,
      stack: 'tokens',
    },
  ],
}))

const chartOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: context => `${context.dataset.label}: ${formatNumber(Number(context.raw || 0))}`,
      },
    },
  },
  scales: {
    x: {
      stacked: true,
      grid: { display: false },
      ticks: { maxTicksLimit: 10, maxRotation: 0 },
    },
    y: {
      stacked: true,
      beginAtZero: true,
      border: { display: false },
      ticks: { callback: value => formatCompactNumber(Number(value)) },
    },
  },
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value || 0)
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)
}

function formatPercent(value: number) {
  return `${Math.round((value || 0) * 100)}%`
}

async function fetchStatistics() {
  if (!range.value)
    return
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await fetchUserStatistics<StatisticsResponse>(
      isAdmin.value ? selectedUser.value : '',
      dayjs(range.value[0]).startOf('day').valueOf(),
      dayjs(range.value[1]).endOf('day').valueOf(),
    )
    summary.value = data.summary || emptySummary()
    dailyUsage.value = data.chartData || []
    userRanking.value = data.userRanking || []
    modelDistribution.value = data.modelDistribution || []
  }
  catch (error: any) {
    summary.value = emptySummary()
    dailyUsage.value = []
    userRanking.value = []
    modelDistribution.value = []
    errorMessage.value = error?.message || t('setting.statisticsLoadFailed')
  }
  finally {
    loading.value = false
  }
}

async function fetchUserOptions() {
  if (!isAdmin.value)
    return
  try {
    users.value = (await fetchGetAllUserOption()).data as UserOption[]
  }
  catch {
    users.value = []
  }
}

onMounted(async () => {
  await fetchUserOptions()
  await fetchStatistics()
})
</script>

<template>
  <NSpin :show="loading">
    <section class="usage-page">
      <header class="usage-header">
        <div>
          <p class="usage-eyebrow">
            {{ $t('setting.statisticsEyebrow') }}
          </p>
          <h2 class="usage-title">
            {{ $t('setting.statisticsOverview') }}
          </h2>
          <p class="usage-description">
            {{ $t('setting.statisticsDescription') }}
          </p>
        </div>

        <div class="usage-filters">
          <NSelect
            v-if="isAdmin"
            v-model:value="selectedUser"
            class="user-select"
            :options="userOptions"
            filterable
            @update:value="fetchStatistics"
          />
          <NDatePicker
            v-model:value="range"
            type="daterange"
            :shortcuts="rangeShortcuts"
            :clearable="false"
            @update:value="fetchStatistics"
          />
        </div>
      </header>

      <div v-if="errorMessage" class="usage-error">
        <SvgIcon icon="ri:error-warning-line" />
        <span>{{ errorMessage }}</span>
      </div>

      <div class="metric-grid">
        <article class="metric-card">
          <div class="metric-icon">
            <SvgIcon icon="ri:pulse-line" />
          </div>
          <p class="metric-label">
            {{ $t('setting.statisticsRequests') }}
          </p>
          <strong class="metric-value">{{ formatNumber(summary.requestCount) }}</strong>
          <span class="metric-note">{{ $t('setting.statisticsRequestsNote') }}</span>
        </article>

        <article class="metric-card">
          <div class="metric-icon metric-icon-indigo">
            <SvgIcon icon="ri:token-swap-line" />
          </div>
          <p class="metric-label">
            {{ $t('setting.statisticsTotalTokens') }}
          </p>
          <strong class="metric-value">{{ formatCompactNumber(summary.totalTokens) }}</strong>
          <span class="metric-note">{{ formatCompactNumber(summary.promptTokens) }} {{ $t('setting.statisticsInputShort') }} · {{ formatCompactNumber(summary.completionTokens) }} {{ $t('setting.statisticsOutputShort') }}</span>
        </article>

        <article class="metric-card">
          <div class="metric-icon metric-icon-cyan">
            <SvgIcon icon="ri:divide-line" />
          </div>
          <p class="metric-label">
            {{ $t('setting.statisticsAverage') }}
          </p>
          <strong class="metric-value">{{ formatCompactNumber(summary.averageTokens) }}</strong>
          <span class="metric-note">{{ $t('setting.statisticsAverageNote') }}</span>
        </article>

        <article class="metric-card">
          <div class="metric-icon metric-icon-amber">
            <SvgIcon icon="ri:calculator-line" />
          </div>
          <p class="metric-label">
            {{ $t('setting.statisticsEstimated') }}
          </p>
          <strong class="metric-value">{{ formatPercent(summary.estimatedRate) }}</strong>
          <span class="metric-note">{{ formatNumber(summary.estimatedCount) }} {{ $t('setting.statisticsEstimatedNote') }}</span>
        </article>
      </div>

      <article class="panel trend-panel">
        <div class="panel-heading">
          <div>
            <h3>{{ $t('setting.statisticsTokenFlow') }}</h3>
            <p>{{ $t('setting.statisticsTokenFlowDescription') }}</p>
          </div>
          <div class="chart-legend" aria-label="图例">
            <span><i class="legend-dot legend-prompt" />{{ $t('setting.statisticsPrompt') }}</span>
            <span><i class="legend-dot legend-completion" />{{ $t('setting.statisticsCompletion') }}</span>
          </div>
        </div>
        <div v-if="hasUsage" class="chart-wrap">
          <Bar :options="chartOptions" :data="chartData" />
        </div>
        <NEmpty v-else class="empty-state" :description="$t('setting.statisticsEmpty')" />
      </article>

      <div class="breakdown-grid" :class="{ 'single-column': !isAdmin || selectedUser !== 'all' }">
        <article v-if="isAdmin && selectedUser === 'all'" class="panel breakdown-panel">
          <div class="panel-heading">
            <div>
              <h3>{{ $t('setting.statisticsUserRanking') }}</h3>
              <p>{{ $t('setting.statisticsUserRankingDescription') }}</p>
            </div>
          </div>
          <div v-if="userRanking.length" class="ranking-list">
            <div v-for="(item, index) in userRanking" :key="item.userId" class="ranking-row">
              <span class="ranking-index">{{ String(index + 1).padStart(2, '0') }}</span>
              <div class="ranking-main">
                <div class="ranking-copy">
                  <strong>{{ item.remark || item.email }}</strong>
                  <span>{{ formatNumber(item.requestCount) }} {{ $t('setting.statisticsRequestsUnit') }}</span>
                </div>
                <div class="usage-bar">
                  <i :style="{ width: `${item.totalTokens / maxUserTokens * 100}%` }" />
                </div>
              </div>
              <strong class="ranking-value">{{ formatCompactNumber(item.totalTokens) }}</strong>
            </div>
          </div>
          <NEmpty v-else :description="$t('setting.statisticsEmpty')" />
        </article>

        <article class="panel breakdown-panel">
          <div class="panel-heading">
            <div>
              <h3>{{ $t('setting.statisticsModels') }}</h3>
              <p>{{ $t('setting.statisticsModelsDescription') }}</p>
            </div>
          </div>
          <div v-if="modelDistribution.length" class="model-list">
            <div v-for="item in modelDistribution" :key="item.model" class="model-row">
              <div class="model-copy">
                <strong>{{ item.model }}</strong>
                <span>{{ formatNumber(item.requestCount) }} {{ $t('setting.statisticsRequestsUnit') }}</span>
              </div>
              <div class="model-track">
                <i :style="{ width: `${item.totalTokens / maxModelTokens * 100}%` }" />
              </div>
              <strong>{{ formatCompactNumber(item.totalTokens) }}</strong>
            </div>
          </div>
          <NEmpty v-else :description="$t('setting.statisticsEmpty')" />
        </article>
      </div>
    </section>
  </NSpin>
</template>

<style scoped>
.usage-page {
  padding: 24px;
  color: var(--text-primary);
}

.usage-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}

.usage-eyebrow {
  margin: 0 0 5px;
  color: var(--brand-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.usage-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -.03em;
}

.usage-description,
.panel-heading p {
  margin: 5px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.usage-filters {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-select {
  width: 220px;
}

.usage-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding: 10px 12px;
  color: #dc2626;
  background: rgba(239, 68, 68, .08);
  border: 1px solid rgba(239, 68, 68, .2);
  border-radius: 8px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.metric-card,
.panel {
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: 12px;
}

.metric-card {
  position: relative;
  min-width: 0;
  padding: 17px;
  overflow: hidden;
}

.metric-icon {
  display: grid;
  width: 30px;
  height: 30px;
  margin-bottom: 18px;
  color: #4f46e5;
  background: rgba(99, 102, 241, .12);
  border-radius: 8px;
  place-items: center;
}

.metric-icon-cyan { color: #0891b2; background: rgba(34, 211, 238, .13); }
.metric-icon-amber { color: #d97706; background: rgba(245, 158, 11, .13); }

.metric-label {
  margin: 0 0 5px;
  color: var(--text-secondary);
  font-size: 12px;
}

.metric-value {
  display: block;
  overflow: hidden;
  font-size: 27px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-note {
  display: block;
  margin-top: 7px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel {
  padding: 18px;
}

.trend-panel {
  margin-bottom: 12px;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.panel-heading h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}

.chart-legend {
  display: flex;
  gap: 14px;
  color: var(--text-secondary);
  font-size: 11px;
}

.chart-legend span {
  display: flex;
  align-items: center;
  gap: 5px;
}

.legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}

.legend-prompt { background: #818cf8; }
.legend-completion { background: #22d3ee; }

.chart-wrap {
  height: 270px;
}

.empty-state {
  padding: 54px 0;
}

.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.breakdown-grid.single-column {
  grid-template-columns: 1fr;
}

.ranking-list,
.model-list {
  display: grid;
  gap: 13px;
}

.ranking-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.ranking-index {
  color: var(--text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.ranking-copy,
.model-copy {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.ranking-copy strong,
.model-copy strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ranking-copy span,
.model-copy span {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 10px;
}

.usage-bar,
.model-track {
  height: 4px;
  overflow: hidden;
  background: var(--surface-hover);
  border-radius: 999px;
}

.usage-bar i,
.model-track i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #818cf8);
  border-radius: inherit;
}

.ranking-value,
.model-row > strong {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.model-row {
  display: grid;
  grid-template-columns: minmax(120px, .8fr) minmax(100px, 1fr) 50px;
  align-items: center;
  gap: 12px;
}

.model-copy {
  display: block;
  min-width: 0;
  margin: 0;
}

.model-copy span {
  display: block;
  margin-top: 2px;
}

.model-track i {
  background: linear-gradient(90deg, #0891b2, #22d3ee);
}

@media (max-width: 900px) {
  .usage-header { align-items: stretch; flex-direction: column; }
  .usage-filters { align-items: stretch; }
  .usage-filters > * { flex: 1; }
  .user-select { width: auto; }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .breakdown-grid { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .usage-page { padding: 14px; }
  .usage-filters { flex-direction: column; }
  .metric-grid { gap: 8px; }
  .metric-card { padding: 14px; }
  .metric-icon { margin-bottom: 12px; }
  .metric-value { font-size: 23px; }
  .chart-wrap { height: 220px; }
  .chart-legend { flex-direction: column; gap: 4px; }
  .model-row { grid-template-columns: minmax(100px, 1fr) 50px; }
  .model-track { display: none; }
}
</style>
