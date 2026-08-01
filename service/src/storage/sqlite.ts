import { Database } from 'sqlite3'
import * as dotenv from 'dotenv'
import dayjs from 'dayjs'
import { md5 } from '../utils/security'
import { ChatInfo, ChatRoom, ChatUsage, Status, UserInfo, UserRole, Config, ChatOptions, KeyConfig, PluginConfig } from './model'
import type { UsageResponse } from './model'
import fs from 'fs'

interface ChatDBRow {
  id: number
  roomId: number
  uuid: number
  dateTime: number
  prompt: string
  images: string      // 存储为 JSON 字符串
  response?: string
  status: number
  options: string     // 存储为 JSON 字符串
  previousResponse?: string  // 存储为 JSON 字符串
}

interface ChatRoomDBRow {
  id: number
  roomId: number
  userId: string
  title: string
  titleSource?: string
  prompt?: string
  usingContext: boolean
  usingDraw?: boolean
  status: number
  chatModel: string
}

interface UserDBRow {
  id: number
  name: string
  email: string
  password: string
  status: number
  createTime: string
  verifyTime?: string
  visitTime?: string
  avatar?: string
  description?: string
  updateTime?: string
  roles: string
  remark?: string
  config?: string
}

interface ConfigDBRow {
  id: number
  timeoutMs: number
  apiKey?: string
  apiBaseUrl?: string
  apiDisableDebug?: boolean
  socksProxy?: string
  socksAuth?: string
  httpsProxy?: string
  siteConfig?: string
  mailConfig?: string
  auditConfig?: string
}

interface KeyConfigDBRow {
  id: number
  key: string
  status: number
  userRoles: string
  chatModels: string
  apiBaseUrl?: string
  remark?: string
  availableModels?: string
}

interface PluginConfigDBRow {
  id: string
  name: string
  published: number
  settings: string
}

interface UserPluginConfigDBRow {
  user_id: string
  plugin_id: string
  enabled: number
}

interface PluginStorageDBRow {
  value: string
}

dotenv.config()

// 确保数据库目录存在
if (!fs.existsSync('./data'))
  fs.mkdirSync('./data', { recursive: true })

const db = new Database('./data/chatgpt.db')

// 初始化数据库表
db.serialize(() => {
  // 启用 WAL 和适度同步提升并发读写稳定性
  db.run('PRAGMA journal_mode=WAL')
  db.run('PRAGMA synchronous=NORMAL')
  // 创建聊天记录表
  db.run(`CREATE TABLE IF NOT EXISTS chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roomId INTEGER NOT NULL,
    uuid INTEGER NOT NULL,
    dateTime INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    images TEXT DEFAULT '[]',
    response TEXT,
    status INTEGER DEFAULT 0,
    options TEXT DEFAULT '{}',
    previousResponse TEXT DEFAULT '[]'
  )`)

  // 创建聊天室表
  db.run(`CREATE TABLE IF NOT EXISTS chat_room (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roomId INTEGER NOT NULL,
    userId TEXT NOT NULL,
    title TEXT NOT NULL,
    titleSource TEXT DEFAULT 'placeholder',
    prompt TEXT,
    usingContext BOOLEAN DEFAULT true,
    status INTEGER DEFAULT 0,
    chatModel TEXT DEFAULT 'gpt-3.5-turbo'
  )`)

  // 旧数据库中已有标题不参与自动重命名
  db.run("ALTER TABLE chat_room ADD COLUMN titleSource TEXT DEFAULT 'legacy'", [], (err) => {
    // ignore error if column already exists
  })

  // 尝试为 chat_room 增加 usingDraw 字段（若已存在则忽略错误）
  db.run('ALTER TABLE chat_room ADD COLUMN usingDraw BOOLEAN DEFAULT 0', [], (err) => {
    // ignore error if column already exists
  })

  // 创建用户表
  db.run(`CREATE TABLE IF NOT EXISTS user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    status INTEGER DEFAULT 0,
    createTime TEXT NOT NULL,
    verifyTime TEXT,
    visitTime TEXT,
    avatar TEXT,
    description TEXT,
    updateTime TEXT,
    roles TEXT DEFAULT '[1]',
    remark TEXT
  )`)

  // 尝试为 user 增加 config 字段（若已存在则忽略错误）
  db.run('ALTER TABLE user ADD COLUMN config TEXT', [], (err) => {
    // ignore error if column already exists
  })

  // 创建配置表
  db.run(`CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timeoutMs INTEGER NOT NULL,
    apiKey TEXT,
    apiBaseUrl TEXT,
    apiDisableDebug BOOLEAN,
    socksProxy TEXT,
    socksAuth TEXT,
    httpsProxy TEXT,
    siteConfig TEXT,
    mailConfig TEXT,
    auditConfig TEXT
  )`)

  // 创建使用统计表
  db.run(`CREATE TABLE IF NOT EXISTS chat_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    roomId INTEGER NOT NULL,
    chatId INTEGER NOT NULL,
    messageId TEXT NOT NULL,
    promptTokens INTEGER NOT NULL,
    completionTokens INTEGER NOT NULL,
    totalTokens INTEGER NOT NULL,
    estimated BOOLEAN NOT NULL,
    dateTime INTEGER NOT NULL
  )`)

  // 创建API密钥配置表
  db.run(`CREATE TABLE IF NOT EXISTS key_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT,
    status INTEGER DEFAULT 0,
    userRoles TEXT,
    chatModels TEXT,
    apiBaseUrl TEXT,
    remark TEXT,
    availableModels TEXT
  )`)

  // 尝试为 key_config 增加 availableModels 字段（若已存在则忽略错误）
  db.run('ALTER TABLE key_config ADD COLUMN availableModels TEXT DEFAULT \'[]\'', [], (err) => {
    // ignore error if column already exists
  })

})

// 修改数据库查询方法的类型定义
const promisifyGet = <T extends Record<string, any>>(sql: string, params: any[] = []): Promise<T | null> => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err: Error | null, row: T) => {
      if (err) reject(err)
      resolve(row || null)
    })
  })
}

const promisifyAll = <T extends Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => {
      if (err) reject(err)
      resolve(rows || [])
    })
  })
}

const promisifyRun = (sql: string, params: any[] = []): Promise<{ lastID: number, changes: number }> => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err: Error | null) {
      if (err) reject(err)
      else resolve({ lastID: this.lastID, changes: this.changes })
    })
  })
}

// 插入聊天信息
export async function insertChat(uuid: number, text: string, roomId: number, options?: ChatOptions, images?: string[]) {
  const chatInfo = new ChatInfo(roomId, uuid, text, options)
  chatInfo.images = Array.isArray(images) ? images : []
  return new Promise<ChatInfo>((resolve, reject) => {
    const sql = 'INSERT INTO chat (roomId, uuid, dateTime, prompt, images, options) VALUES (?, ?, ?, ?, ?, ?)'
    db.run(sql, [roomId, uuid, chatInfo.dateTime, text, JSON.stringify(chatInfo.images || []), JSON.stringify(options || new ChatOptions())], function(err) {
      if (err) reject(err)
      else {
        chatInfo.id = this.lastID
        resolve(chatInfo)
      }
    })
  })
}

// 获取聊天信息
export async function getChatByMessageId(messageId: string): Promise<ChatInfo | undefined> {
  const row = await promisifyGet<ChatDBRow>('SELECT * FROM chat WHERE json_extract(options, "$.messageId") = ?', [messageId])
  if (!row) return undefined
  
  const chatInfo = new ChatInfo(
    row.roomId,
    row.uuid,
    row.prompt,
    JSON.parse(row.options)
  )
  chatInfo.id = row.id
  chatInfo.images = row.images ? JSON.parse(row.images) : []
  chatInfo.dateTime = row.dateTime
  chatInfo.response = row.response
  chatInfo.status = row.status
  chatInfo.previousResponse = row.previousResponse ? JSON.parse(row.previousResponse) : undefined
  
  return chatInfo
}

// 创建聊天室
export async function createChatRoom(userId: string, title: string, roomId: number, chatModel: string) {
  const room = new ChatRoom(userId, title, roomId, chatModel)
  return new Promise<ChatRoom>((resolve, reject) => {
    const sql = 'INSERT INTO chat_room (userId, title, titleSource, roomId, chatModel) VALUES (?, ?, ?, ?, ?)'
    db.run(sql, [userId, title, 'placeholder', roomId, chatModel], function(err) {
      if (err) reject(err)
      else {
        room.id = this.lastID
        resolve(room)
      }
    })
  })
}

// 获取聊天室列表
export async function getChatRooms(userId: string): Promise<ChatRoom[]> {
  const rows = await promisifyAll<ChatRoomDBRow>('SELECT * FROM chat_room WHERE userId = ? AND status != ?', [userId, Status.Deleted])
  return rows.map(row => {
    const room = new ChatRoom(row.userId, row.title, row.roomId, row.chatModel)
    room.id = row.id
    room.titleSource = row.titleSource || 'legacy'
    room.prompt = row.prompt || ''
    room.usingContext = row.usingContext
    room.usingDraw = row.usingDraw ?? false
    room.status = row.status
    room.chatModel = row.chatModel
    return room
  })
}

// 更新聊天室聊天模型
export async function updateRoomChatModel(userId: string, roomId: number, chatModel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sql = 'UPDATE chat_room SET chatModel = ? WHERE userId = ? AND roomId = ?'
    db.run(sql, [chatModel, userId, roomId], function(err) {
      resolve(!err)
    })
  })
}

// 创建用户
export async function createUser(email: string, password: string, roles?: UserRole[], remark?: string): Promise<UserInfo> {
  const userInfo = new UserInfo(email, password)
  if (roles && roles.includes(UserRole.Admin))
    userInfo.status = Status.Normal
  userInfo.roles = roles
  userInfo.remark = remark

  return new Promise<UserInfo>((resolve, reject) => {
    const sql = 'INSERT INTO user (name, email, password, status, createTime, updateTime, roles, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    db.run(sql, [
      userInfo.name,
      userInfo.email,
      userInfo.password,
      userInfo.status,
      userInfo.createTime,
      userInfo.updateTime,
      JSON.stringify(userInfo.roles),
      userInfo.remark
    ], function(err) {
      if (err) reject(err)
      else {
        userInfo.id = this.lastID
        resolve(userInfo)
      }
    })
  })
}

// 获取用户信息
export async function getUser(email: string): Promise<UserInfo | null> {
  email = email.toLowerCase()
  const row = await promisifyGet<UserDBRow>('SELECT * FROM user WHERE email = ? COLLATE NOCASE', [email])
  if (!row) return null
  
  const userInfo = new UserInfo(row.email, row.password)
  userInfo.id = row.id
  userInfo.name = row.name
  userInfo.status = row.status
  userInfo.createTime = row.createTime
  userInfo.verifyTime = row.verifyTime
  userInfo.visitTime = row.visitTime
  userInfo.avatar = row.avatar
  userInfo.description = row.description
  userInfo.updateTime = row.updateTime
  userInfo.roles = JSON.parse(row.roles)
  userInfo.remark = row.remark
  userInfo.config = JSON.parse(row.config || '{}')  
  initUserInfo(userInfo)
  return userInfo
}

// 获取配置信息
export async function getConfig(): Promise<Config | null> {
  const row = await promisifyGet<ConfigDBRow>('SELECT * FROM config WHERE id = 1')
  if (!row) return null
  
  return new Config(
    row.timeoutMs,
    row.apiKey,
    row.apiBaseUrl,
    row.apiDisableDebug,
    row.socksProxy,
    row.socksAuth,
    row.httpsProxy,
    JSON.parse(row.siteConfig || '{}'),
    JSON.parse(row.mailConfig || '{}')
  )
}

// 更新配置信息
export async function updateConfig(config: Config): Promise<Config> {
  return new Promise((resolve, reject) => {
    // 先检查是否存在配置记录
    db.get('SELECT 1 FROM config WHERE id = 1', [], (err, row) => {
      if (err) {
        reject(err)
        return
      }

      let sql
      let params

      if (row) {
        // 如果存在记录，使用 UPDATE
        sql = `UPDATE config SET
          timeoutMs = ?, apiKey = ?, apiBaseUrl = ?,
          apiDisableDebug = ?, socksProxy = ?,
          socksAuth = ?, httpsProxy = ?, siteConfig = ?, mailConfig = ?
          WHERE id = 1`
        params = [
          config.timeoutMs,
          config.apiKey,
          config.apiBaseUrl,
          config.apiDisableDebug,
          config.socksProxy,
          config.socksAuth,
          config.httpsProxy,
          JSON.stringify(config.siteConfig),
          JSON.stringify(config.mailConfig)
        ]
      } else {
        // 如果不存在记录，使用 INSERT
        sql = `INSERT INTO config (
          timeoutMs, apiKey, apiBaseUrl, apiDisableDebug,
          socksProxy, socksAuth, httpsProxy,
          siteConfig, mailConfig
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        params = [
          config.timeoutMs,
          config.apiKey,
          config.apiBaseUrl,
          config.apiDisableDebug,
          config.socksProxy,
          config.socksAuth,
          config.httpsProxy,
          JSON.stringify(config.siteConfig),
          JSON.stringify(config.mailConfig)
        ]
      }

      db.run(sql, params, (err) => {
        if (err) reject(err)
        else {
          config.id = 1
          resolve(config)
        }
      })
    })
  })
}

// 插入使用统计
export async function insertChatUsage(userId: string, roomId: number, chatId: number, messageId: string, usage: UsageResponse): Promise<ChatUsage> {
  return new Promise((resolve, reject) => {
    const chatUsage = new ChatUsage(userId, roomId, chatId, messageId, usage)
    const sql = `INSERT INTO chat_usage (
      userId, roomId, chatId, messageId, promptTokens, completionTokens, totalTokens, estimated, dateTime
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    
    db.run(sql, [
      userId,
      roomId,
      chatId,
      messageId,
      chatUsage.promptTokens,
      chatUsage.completionTokens,
      chatUsage.totalTokens,
      chatUsage.estimated,
      chatUsage.dateTime
    ], function(err) {
      if (err) reject(err)
      else {
        chatUsage.id = this.lastID
        resolve(chatUsage)
      }
    })
  })
}

// 获取API密钥列表
export async function getKeys(): Promise<{ keys: KeyConfig[]; total: number }> {
  const rows = await promisifyAll<KeyConfigDBRow>('SELECT * FROM key_config')
  const keys = rows.map(row => {
    const keyConfig = new KeyConfig(
      row.key,
      row.apiBaseUrl,
      JSON.parse(row.chatModels || '[]'),
      JSON.parse(row.userRoles || '[]'),
      row.remark || ''
    )
    keyConfig.id = row.id
    keyConfig.availableModels = row.availableModels ? JSON.parse(row.availableModels) : []
    return keyConfig
  })
  return { keys, total: keys.length }
}

// 更新API密钥状态
export async function updateApiKeyStatus(id: string, status: Status) {
  return new Promise<void>((resolve, reject) => {
    if (status === Status.Deleted) {
      db.run('DELETE FROM key_config WHERE id = ?', [Number(id)], (err) => {
        if (err) reject(err)
        else resolve()
      })
    } else {
      db.run('UPDATE key_config SET status = ? WHERE id = ?', [status, Number(id)], (err) => {
        if (err) reject(err)
        else resolve()
      })
    }
  })
}

// 更新或插入API密钥
export async function upsertKey(key: KeyConfig): Promise<KeyConfig> {
  if (!key.id) {
    return new Promise<KeyConfig>((resolve, reject) => {
      const sql = 'INSERT INTO key_config (key, status, userRoles, chatModels, apiBaseUrl, remark, availableModels) VALUES (?, ?, ?, ?, ?, ?, ?)'
      db.run(sql, [
        key.key,
        key.status,
        JSON.stringify(key.userRoles),
        JSON.stringify(key.chatModels),
        key.apiBaseUrl,
        key.remark,
        JSON.stringify(key.availableModels || [])
      ], function(err) {
        if (err) reject(err)
        else {
          key.id = this.lastID
          resolve(key)
        }
      })
    })
  } else {
    return new Promise<KeyConfig>((resolve, reject) => {
      const sql = 'UPDATE key_config SET key = ?, status = ?, userRoles = ?, chatModels = ?, apiBaseUrl = ?, remark = ?, availableModels = ? WHERE id = ?'
      db.run(sql, [
        key.key,
        key.status,
        JSON.stringify(key.userRoles),
        JSON.stringify(key.chatModels),
        key.apiBaseUrl,
        key.remark,
        JSON.stringify(key.availableModels || []),
        Number(key.id)
      ], (err) => {
        if (err) reject(err)
        else resolve(key)
      })
    })
  }
}

// 更新指定 ID 的密钥的可用模型列表
export async function updateKeyAvailableModels(id: number, models: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const sql = 'UPDATE key_config SET availableModels = ? WHERE id = ?'
    db.run(sql, [JSON.stringify(models || []), Number(id)], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// 按 key + apiBaseUrl 更新可用模型列表（用于未传 id 的情况）
export async function updateKeyAvailableModelsByKey(key: string, apiBaseUrl: string | undefined, models: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const sql = 'UPDATE key_config SET availableModels = ? WHERE key = ? AND COALESCE(apiBaseUrl, \'\') = COALESCE(?, \'\')'
    db.run(sql, [JSON.stringify(models || []), key, apiBaseUrl || null], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// 获取用户每日统计数据
interface DailyUsageStatsRow {
  date: string
  requestCount: number
  estimatedCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

interface UsageRankingRow {
  userId: string
  email: string
  remark?: string
  requestCount: number
  totalTokens: number
}

interface ModelUsageRow {
  model: string
  requestCount: number
  totalTokens: number
}

export async function getUserStatisticsByDay(userId: string | null, start: number, end: number): Promise<any> {
  const userWhere = userId === null ? '' : 'AND cu.userId = ?'
  const params = userId === null ? [start, end] : [start, end, userId]
  const dailyRows = await promisifyAll<DailyUsageStatsRow>(`
    SELECT
      date(datetime(cu.dateTime / 1000, 'unixepoch', 'localtime')) AS date,
      COUNT(*) AS requestCount,
      SUM(CASE WHEN cu.estimated THEN 1 ELSE 0 END) AS estimatedCount,
      SUM(cu.promptTokens) AS promptTokens,
      SUM(cu.completionTokens) AS completionTokens,
      SUM(cu.totalTokens) AS totalTokens
    FROM chat_usage cu
    WHERE cu.dateTime >= ? AND cu.dateTime <= ? ${userWhere}
    GROUP BY date
    ORDER BY date ASC
  `, params)

  const userRanking = await promisifyAll<UsageRankingRow>(`
    SELECT
      cu.userId AS userId,
      COALESCE(u.email, cu.userId) AS email,
      u.remark AS remark,
      COUNT(*) AS requestCount,
      SUM(cu.totalTokens) AS totalTokens
    FROM chat_usage cu
    LEFT JOIN user u ON CAST(u.id AS TEXT) = cu.userId
    WHERE cu.dateTime >= ? AND cu.dateTime <= ? ${userWhere}
    GROUP BY cu.userId, u.email, u.remark
    ORDER BY totalTokens DESC
    LIMIT 10
  `, params)

  const modelDistribution = await promisifyAll<ModelUsageRow>(`
    SELECT
      COALESCE(NULLIF(cr.chatModel, ''), '未知模型') AS model,
      COUNT(*) AS requestCount,
      SUM(cu.totalTokens) AS totalTokens
    FROM chat_usage cu
    LEFT JOIN chat_room cr ON cr.roomId = cu.roomId AND cr.userId = cu.userId
    WHERE cu.dateTime >= ? AND cu.dateTime <= ? ${userWhere}
    GROUP BY model
    ORDER BY totalTokens DESC
    LIMIT 10
  `, params)

  const summary = {
    requestCount: 0,
    estimatedCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    averageTokens: 0,
    estimatedRate: 0,
  }
  const dailyMap = new Map(dailyRows.map(row => [row.date, row]))
  const chartData: Array<DailyUsageStatsRow & { id: string }> = []
  const cursor = dayjs(start).startOf('day')
  const lastDay = dayjs(end).startOf('day')

  for (let day = cursor; day.valueOf() <= lastDay.valueOf(); day = day.add(1, 'day')) {
    const date = day.format('YYYY-MM-DD')
    const stored = dailyMap.get(date)
    const row = {
      date,
      requestCount: Number(stored?.requestCount) || 0,
      estimatedCount: Number(stored?.estimatedCount) || 0,
      promptTokens: Number(stored?.promptTokens) || 0,
      completionTokens: Number(stored?.completionTokens) || 0,
      totalTokens: Number(stored?.totalTokens) || 0,
    }
    summary.requestCount += row.requestCount
    summary.estimatedCount += row.estimatedCount
    summary.promptTokens += row.promptTokens
    summary.completionTokens += row.completionTokens
    summary.totalTokens += row.totalTokens
    chartData.push({ id: date, ...row })
  }

  summary.averageTokens = summary.requestCount > 0 ? Math.round(summary.totalTokens / summary.requestCount) : 0
  summary.estimatedRate = summary.requestCount > 0 ? summary.estimatedCount / summary.requestCount : 0

  return {
    ...summary,
    summary,
    chartData,
    userRanking: userRanking.map(row => ({
      ...row,
      requestCount: Number(row.requestCount) || 0,
      totalTokens: Number(row.totalTokens) || 0,
    })),
    modelDistribution: modelDistribution.map(row => ({
      ...row,
      requestCount: Number(row.requestCount) || 0,
      totalTokens: Number(row.totalTokens) || 0,
    })),
  }
}

// 清除聊天记录
export async function clearChat(roomId: number) {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE chat SET status = ? WHERE roomId = ?'
    db.run(sql, [Status.Deleted, roomId], (err) => {
      if (err) reject(err)
      else resolve(null)
    })
  })
}

// 删除所有聊天室
export async function deleteAllChatRooms(userId: string) {
  return new Promise<void>((resolve, reject) => {
    db.run('UPDATE chat_room SET status = ? WHERE userId = ? AND status = ?',
      [Status.Deleted, userId, Status.Normal], (err) => {
        if (err) reject(err)
        else {
          db.run('UPDATE chat SET status = ? WHERE roomId IN (SELECT roomId FROM chat_room WHERE userId = ?) AND status = ?',
            [Status.Deleted, userId, Status.Normal], (err2) => {
              if (err2) reject(err2)
              else resolve()
            })
        }
      })
  })
}

// 删除聊天记录
export async function deleteChat(roomId: number, uuid: number, inversion: boolean) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM chat WHERE roomId = ? AND uuid = ?'
    db.get<ChatDBRow>(sql, [roomId, uuid], (err, chat) => {
      if (err) reject(err)
      else {
        let newStatus
        if (chat.status === Status.InversionDeleted && !inversion) { /* empty */ }
        else if (chat.status === Status.ResponseDeleted && inversion) { /* empty */ }
        else if (inversion) {
          newStatus = Status.InversionDeleted
        }
        else {
          newStatus = Status.ResponseDeleted
        }
        
        if (newStatus) {
          db.run('UPDATE chat SET status = ? WHERE roomId = ? AND uuid = ?', [newStatus, roomId, uuid], (err) => {
            if (err) reject(err)
            else resolve(null)
          })
        }
        else {
          resolve(null)
        }
      }
    })
  })
}

// 删除聊天室
export async function deleteChatRoom(userId: string, roomId: number) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('UPDATE chat_room SET status = ? WHERE roomId = ? AND userId = ?', [Status.Deleted, roomId, userId])
      db.run('UPDATE chat SET status = ? WHERE roomId = ?', [Status.Deleted, roomId])
      resolve(null)
    })
  })
}

// 检查聊天室是否存在
export async function existsChatRoom(userId: string, roomId: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT 1 FROM chat_room WHERE userId = ? AND roomId = ?'
    db.get(sql, [userId, roomId], (err, row) => {
      if (err) reject(err)
      else resolve(!!row)
    })
  })
}

// 获取聊天室
export async function getChatRoom(userId: string, roomId: number): Promise<ChatRoom | null> {
  const row = await promisifyGet<ChatRoomDBRow>('SELECT * FROM chat_room WHERE userId = ? AND roomId = ? AND status != ?', [userId, roomId, Status.Deleted])
  if (!row) return null
  
  const room = new ChatRoom(row.userId, row.title, row.roomId, row.chatModel)
  room.id = row.id
  room.titleSource = row.titleSource || 'legacy'
  room.prompt = row.prompt
  room.usingContext = row.usingContext
  room.usingDraw = row.usingDraw ?? false
  room.status = row.status
  room.chatModel = row.chatModel
  return room
}

// 获取聊天记录列表
export async function getChats(roomId: number, lastId?: number): Promise<ChatInfo[]> {
  if (!lastId) lastId = new Date().getTime()
  const rows = await promisifyAll<ChatDBRow>('SELECT * FROM chat WHERE roomId = ? AND uuid < ? AND status != ? ORDER BY dateTime DESC LIMIT 20', [roomId, lastId, Status.Deleted])
  
  const chats = rows.map(row => {
    const chatInfo = new ChatInfo(row.roomId, row.uuid, row.prompt, JSON.parse(row.options))
    chatInfo.id = row.id
    chatInfo.dateTime = row.dateTime
    chatInfo.response = row.response
    chatInfo.status = row.status
    chatInfo.previousResponse = row.previousResponse ? JSON.parse(row.previousResponse) : undefined
    return chatInfo
  })
  chats.reverse()
  return chats
}

// 获取用户信息通过ID
export async function getUserById(userId: string): Promise<UserInfo> {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM user WHERE id = ?'
    db.get<UserDBRow>(sql, [userId], (err, row) => {
      if (err) reject(err)
      else {
        if (row) {
          const userInfo = new UserInfo(row.email, row.password)
          userInfo.id = row.id
          userInfo.name = row.name
          userInfo.status = row.status
          userInfo.createTime = row.createTime
          userInfo.verifyTime = row.verifyTime
          userInfo.visitTime = row.visitTime
          userInfo.avatar = row.avatar
          userInfo.description = row.description
          userInfo.updateTime = row.updateTime
          userInfo.roles = JSON.parse(row.roles)
          userInfo.remark = row.remark
          userInfo.config = JSON.parse(row.config || '{}')
          resolve(userInfo)
        }
        else resolve(null)
      }
    })
  })
}

// 获取用户列表
export async function getUsers(page: number, size: number): Promise<{ users: UserInfo[]; total: number }> {
  let sql = 'SELECT * FROM user ORDER BY createTime DESC'
  if (size !== -1) {
    const offset = (page - 1) * size
    sql += ` LIMIT ${size} OFFSET ${offset}`
  }

  const rows = await promisifyAll<UserDBRow>(sql)
  const totalResult = await promisifyGet<{ count: number }>('SELECT COUNT(*) as count FROM user')
  const total = totalResult ? totalResult.count : 0

  const users = rows.map(row => {
    const userInfo = new UserInfo(row.email, row.password)
    userInfo.id = row.id
    userInfo.name = row.name
    userInfo.status = row.status
    userInfo.createTime = row.createTime
    userInfo.verifyTime = row.verifyTime
    userInfo.visitTime = row.visitTime
    userInfo.avatar = row.avatar
    userInfo.description = row.description
    userInfo.updateTime = row.updateTime
    userInfo.roles = JSON.parse(row.roles)
    userInfo.remark = row.remark
    userInfo.config = JSON.parse(row.config || '{}')
    return userInfo
  })

  return { users, total }
}

// 重命名聊天室
export async function renameChatRoom(userId: string, title: string, roomId: number, titleSource = 'manual'): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE chat_room SET title = ?, titleSource = ? WHERE userId = ? AND roomId = ?'
    db.run(sql, [title, titleSource, userId, roomId], function(err) {
      if (err) reject(err)
      else resolve(this.changes > 0)
    })
  })
}

export async function updateAutomaticRoomTitle(userId: string, title: string, roomId: number, titleSource: 'fallback' | 'generated'): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const sql = "UPDATE chat_room SET title = ?, titleSource = ? WHERE userId = ? AND roomId = ? AND titleSource = 'placeholder'"
    db.run(sql, [title, titleSource, userId, roomId], function(err) {
      if (err) reject(err)
      else resolve(this.changes > 0)
    })
  })
}

// 更新聊天室提示词
export async function updateRoomPrompt(userId: string, roomId: number, prompt: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE chat_room SET prompt = ? WHERE userId = ? AND roomId = ?'
    db.run(sql, [prompt, userId, roomId], function(err) {
      if (err) reject(err)
      else resolve(this.changes > 0)
    })
  })
}

// 更新聊天室上下文设置
export async function updateRoomUsingContext(userId: string, roomId: number, using: boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE chat_room SET usingContext = ? WHERE userId = ? AND roomId = ?'
    db.run(sql, [using, userId, roomId], function(err) {
      if (err) reject(err)
      else resolve(this.changes > 0)
    })
  })
}



// 更新聊天室绘图设置
export async function updateRoomUsingDraw(userId: string, roomId: number, using: boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE chat_room SET usingDraw = ? WHERE userId = ? AND roomId = ?'
    db.run(sql, [using, userId, roomId], function(err) {
      if (err) reject(err)
      else resolve(this.changes > 0)
    })
  })
}

// 更新用户信息
export async function updateUser(userId: string, roles: UserRole[], password: string, remark?: string) {
  const row = await promisifyGet<UserDBRow>('SELECT password FROM user WHERE id = ?', [Number(userId)])
  if (!row) return null

  const sql = row.password !== password && row.password
    ? 'UPDATE user SET roles = ?, verifyTime = ?, password = ?, remark = ? WHERE id = ?'
    : 'UPDATE user SET roles = ?, verifyTime = ?, remark = ? WHERE id = ?'
  
  const params = row.password !== password && row.password
    ? [JSON.stringify(roles), new Date().toLocaleString(), md5(password), remark, Number(userId)]
    : [JSON.stringify(roles), new Date().toLocaleString(), remark, Number(userId)]
  
  return new Promise<void>((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// 更新用户基本信息
export async function updateUserInfo(userId: string, user: UserInfo) {
  return new Promise<void>((resolve, reject) => {
    const sql = 'UPDATE user SET name = ?, description = ?, avatar = ?, config = ? WHERE id = ?'
    db.run(sql, [user.name, user.description, user.avatar, JSON.stringify(user.config ?? {}), Number(userId)], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// 更新用户密码
export async function updateUserPassword(userId: string, password: string) {
  return new Promise<void>((resolve, reject) => {
    const sql = 'UPDATE user SET password = ?, updateTime = ? WHERE id = ?'
    db.run(sql, [password, new Date().toLocaleString(), Number(userId)], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// 更新用户状态
export async function updateUserStatus(userId: string, status: Status) {
  return new Promise<void>((resolve, reject) => {
    if (status === Status.Deleted) {
      db.run('DELETE FROM user WHERE id = ?', [Number(userId)], (err) => {
        if (err) reject(err)
        else resolve()
      })
    } else {
      const sql = 'UPDATE user SET status = ?, verifyTime = ? WHERE id = ?'
      db.run(sql, [status, new Date().toLocaleString(), Number(userId)], (err) => {
        if (err) reject(err)
        else resolve()
      })
    }
  })
}

// 更新用户访问时间
export async function updateUserVisitTime(userId: string, visitTime: string) {
  return new Promise<void>((resolve, reject) => {
    const sql = 'UPDATE user SET visitTime = ? WHERE id = ?'
    db.run(sql, [visitTime, Number(userId)], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// 验证用户
export async function verifyUser(email: string, status: Status) {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE user SET status = ?, verifyTime = ? WHERE email = ? COLLATE NOCASE'
    db.run(sql, [status, new Date().toLocaleString(), email], (err) => {
      if (err) reject(err)
      else resolve(null)
    })
  })
}

export async function getChat(roomId: number, uuid: number): Promise<ChatInfo | null> {
  const row = await promisifyGet<ChatDBRow>('SELECT * FROM chat WHERE roomId = ? AND uuid = ?', [roomId, uuid])
  if (!row) return null
  
  const chatInfo = new ChatInfo(row.roomId, row.uuid, row.prompt, JSON.parse(row.options))
  chatInfo.id = row.id
  chatInfo.dateTime = row.dateTime
  chatInfo.images = row.images ? JSON.parse(row.images) : []
  chatInfo.response = row.response
  chatInfo.status = row.status
  chatInfo.previousResponse = row.previousResponse ? JSON.parse(row.previousResponse) : undefined
  return chatInfo
}

export async function updateChat(chatId: string, response: string, messageId: string, conversationId: string, usage: UsageResponse, previousResponse?: [], thinking?: string) {
  const options = {
    messageId,
    conversationId,
    prompt_tokens: usage?.prompt_tokens,
    completion_tokens: usage?.completion_tokens,
    total_tokens: usage?.total_tokens,
    estimated: usage?.estimated,
    ...(thinking ? { thinking } : {})
  }

  const queries = [{
    sql: 'UPDATE chat SET response = ?, options = ?, previousResponse = ? WHERE id = ?',
    params: [
      response,
      JSON.stringify(options),
      previousResponse ? JSON.stringify(previousResponse) : null,
      Number(chatId)
    ]
  }]

  return runTransaction(queries)
}

function initUserInfo(userInfo: UserInfo) {
  if (!userInfo) return
  
  if (!userInfo.roles || userInfo.roles.length === 0) {
    userInfo.roles = [UserRole.User]
    if (process.env.ROOT_USER === userInfo.email.toLowerCase())
      userInfo.roles.push(UserRole.Admin)
  }
}

const runTransaction = async (queries: Array<{sql: string, params: any[]}>) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION')
      
      for (const {sql, params} of queries) {
        db.run(sql, params)
      }
      
      db.run('COMMIT', (err) => {
        if (err) {
          db.run('ROLLBACK')
          reject(err)
        }
        else resolve(null)
      })
    })
  })
}

const IMAGE_GENERATION_PLUGIN_ID = 'ad373f21b9bd470ca761216e99d95d52'

async function createPluginTables() {
  await promisifyRun(`CREATE TABLE IF NOT EXISTS plugin_config (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0,
    settings TEXT NOT NULL DEFAULT '{}'
  )`)
  await promisifyRun(`CREATE TABLE IF NOT EXISTS user_plugin_config (
    user_id TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, plugin_id),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
    FOREIGN KEY (plugin_id) REFERENCES plugin_config(id) ON DELETE CASCADE
  )`)
  await promisifyRun(`CREATE TABLE IF NOT EXISTS plugin_storage (
    plugin_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('global', 'user')),
    owner_id TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, scope, owner_id, key),
    FOREIGN KEY (plugin_id) REFERENCES plugin_config(id) ON DELETE CASCADE
  )`)
}

export async function initializePluginStorage(): Promise<void> {
  const table = await promisifyGet<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'plugin_config'")
  if (!table) {
    await createPluginTables()
    await promisifyRun('PRAGMA foreign_keys = ON')
    return
  }

  const columns = await promisifyAll<{ name: string, type: string }>('PRAGMA table_info(plugin_config)')
  const idColumn = columns.find(column => column.name === 'id')
  const needsMigration = !idColumn || idColumn.type.toUpperCase() !== 'TEXT' || !columns.some(column => column.name === 'published')

  if (needsMigration) {
    await promisifyRun('PRAGMA foreign_keys = OFF')
    await promisifyRun('BEGIN TRANSACTION')
    try {
      await promisifyRun('DROP TABLE IF EXISTS user_plugin_config')
      await promisifyRun('DROP TABLE IF EXISTS plugin_storage')
      await promisifyRun('ALTER TABLE plugin_config RENAME TO plugin_config_legacy')
      await promisifyRun(`CREATE TABLE plugin_config (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        published INTEGER NOT NULL DEFAULT 0,
        settings TEXT NOT NULL DEFAULT '{}'
      )`)
      await promisifyRun(`INSERT INTO plugin_config (id, name, published, settings)
        SELECT
          CASE WHEN name = 'generate_image' THEN ? ELSE lower(hex(randomblob(16))) END,
          CASE WHEN name = 'generate_image' THEN '图片生成' ELSE name END,
          0,
          COALESCE(settings, '{}')
        FROM plugin_config_legacy`, [IMAGE_GENERATION_PLUGIN_ID])
      await promisifyRun('DROP TABLE plugin_config_legacy')
      await promisifyRun('COMMIT')
    }
    catch (error) {
      await promisifyRun('ROLLBACK')
      throw error
    }
    finally {
      await promisifyRun('PRAGMA foreign_keys = ON')
    }
  }

  await createPluginTables()
  await promisifyRun('PRAGMA foreign_keys = ON')
}

function mapPluginConfig(row: PluginConfigDBRow): PluginConfig {
  return new PluginConfig(row.id, row.name, Boolean(row.published), JSON.parse(row.settings || '{}'))
}

export async function syncPluginConfig(id: string, name: string, defaultSettings: Record<string, any>): Promise<PluginConfig> {
  await promisifyRun(`INSERT INTO plugin_config (id, name, published, settings)
    VALUES (?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name`, [id, name, JSON.stringify(defaultSettings)])
  const config = await getPluginConfig(id)
  if (!config)
    throw new Error(`Failed to synchronize plugin ${id}`)
  return config
}

export async function getPluginConfigs(): Promise<PluginConfig[]> {
  const rows = await promisifyAll<PluginConfigDBRow>('SELECT * FROM plugin_config ORDER BY name, id')
  return rows.map(mapPluginConfig)
}

export async function getPluginConfig(id: string): Promise<PluginConfig | null> {
  const row = await promisifyGet<PluginConfigDBRow>('SELECT * FROM plugin_config WHERE id = ?', [id])
  return row ? mapPluginConfig(row) : null
}

export async function updatePluginConfig(id: string, settings: Record<string, any>): Promise<PluginConfig> {
  const result = await promisifyRun('UPDATE plugin_config SET settings = ? WHERE id = ?', [JSON.stringify(settings), id])
  if (result.changes === 0)
    throw new Error('Plugin not found')
  const config = await getPluginConfig(id)
  if (!config)
    throw new Error('Plugin not found')
  return config
}

export async function updatePluginPublished(id: string, published: boolean): Promise<PluginConfig> {
  const result = await promisifyRun('UPDATE plugin_config SET published = ? WHERE id = ?', [published ? 1 : 0, id])
  if (result.changes === 0)
    throw new Error('Plugin not found')
  const config = await getPluginConfig(id)
  if (!config)
    throw new Error('Plugin not found')
  return config
}

export async function getUserPluginEnabled(userId: string, pluginId: string): Promise<boolean> {
  const row = await promisifyGet<UserPluginConfigDBRow>(
    'SELECT * FROM user_plugin_config WHERE user_id = ? AND plugin_id = ?',
    [userId, pluginId],
  )
  return Boolean(row?.enabled)
}

export async function getEnabledPluginIds(userId: string): Promise<string[]> {
  const rows = await promisifyAll<UserPluginConfigDBRow>(
    'SELECT * FROM user_plugin_config WHERE user_id = ? AND enabled = 1',
    [userId],
  )
  return rows.map(row => row.plugin_id)
}

export async function updateUserPluginEnabled(userId: string, pluginId: string, enabled: boolean): Promise<void> {
  await promisifyRun(`INSERT INTO user_plugin_config (user_id, plugin_id, enabled)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, plugin_id) DO UPDATE SET enabled = excluded.enabled`,
  [userId, pluginId, enabled ? 1 : 0])
}

export async function getPluginStorageValue<T>(pluginId: string, scope: 'global' | 'user', ownerId: string, key: string): Promise<T | null> {
  const row = await promisifyGet<PluginStorageDBRow>(
    'SELECT value FROM plugin_storage WHERE plugin_id = ? AND scope = ? AND owner_id = ? AND key = ?',
    [pluginId, scope, ownerId, key],
  )
  return row ? JSON.parse(row.value) as T : null
}

export async function setPluginStorageValue(pluginId: string, scope: 'global' | 'user', ownerId: string, key: string, value: unknown): Promise<void> {
  await promisifyRun(`INSERT INTO plugin_storage (plugin_id, scope, owner_id, key, value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(plugin_id, scope, owner_id, key)
    DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  [pluginId, scope, ownerId, key, JSON.stringify(value), Date.now()])
}

export async function deletePluginStorageValue(pluginId: string, scope: 'global' | 'user', ownerId: string, key: string): Promise<void> {
  await promisifyRun(
    'DELETE FROM plugin_storage WHERE plugin_id = ? AND scope = ? AND owner_id = ? AND key = ?',
    [pluginId, scope, ownerId, key],
  )
}
