import { Database } from 'sqlite3'
import * as dotenv from 'dotenv'
import dayjs from 'dayjs'
import { md5 } from '../utils/security'
import { ChatInfo, ChatRoom, ChatUsage, Status, UserInfo, UserRole, Config, ChatOptions, KeyConfig } from './model'
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
  prompt?: string
  usingContext: boolean
  usingThinking?: boolean
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
    prompt TEXT,
    usingContext BOOLEAN DEFAULT true,
    status INTEGER DEFAULT 0,
    chatModel TEXT DEFAULT 'gpt-3.5-turbo'
  )`)

  // 尝试为 chat_room 增加 usingThinking 字段（若已存在则忽略错误）
  db.run('ALTER TABLE chat_room ADD COLUMN usingThinking BOOLEAN DEFAULT 0', [], (err) => {
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
    const sql = 'INSERT INTO chat_room (userId, title, roomId, chatModel) VALUES (?, ?, ?, ?)'
    db.run(sql, [userId, title, roomId, chatModel], function(err) {
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
    room.prompt = row.prompt || ''
    room.usingContext = row.usingContext
    room.usingThinking = row.usingThinking ?? false
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
    JSON.parse(row.mailConfig || '{}'),
    JSON.parse(row.auditConfig || '{}')
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
          socksAuth = ?, httpsProxy = ?, siteConfig = ?, mailConfig = ?, 
          auditConfig = ? 
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
          JSON.stringify(config.mailConfig),
          JSON.stringify(config.auditConfig)
        ]
      } else {
        // 如果不存在记录，使用 INSERT
        sql = `INSERT INTO config (
          timeoutMs, apiKey, apiBaseUrl, apiDisableDebug, 
          socksProxy, socksAuth, httpsProxy, 
          siteConfig, mailConfig, auditConfig
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        params = [
          config.timeoutMs,
          config.apiKey,
          config.apiBaseUrl,
          config.apiDisableDebug,
          config.socksProxy,
          config.socksAuth,
          config.httpsProxy,
          JSON.stringify(config.siteConfig),
          JSON.stringify(config.mailConfig),
          JSON.stringify(config.auditConfig)
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
    const sql = 'UPDATE key_config SET availableModels = ? WHERE key = ? AND (apiBaseUrl = ? OR (? IS NULL AND apiBaseUrl IS NULL))'
    db.run(sql, [JSON.stringify(models || []), key, apiBaseUrl || null, apiBaseUrl || null], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// 获取用户每日统计数据
interface UsageStatsRow {
  date: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export async function getUserStatisticsByDay(userId: string, start: number, end: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        date(datetime(dateTime/1000, 'unixepoch')) as date,
        SUM(promptTokens) as promptTokens,
        SUM(completionTokens) as completionTokens,
        SUM(totalTokens) as totalTokens
      FROM chat_usage 
      WHERE userId = ? AND dateTime >= ? AND dateTime <= ?
      GROUP BY date
      ORDER BY date ASC
    `
    
    db.all<UsageStatsRow>(sql, [userId, start, end], (err, rows) => {
      if (err) reject(err)
      else {
        const result = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          chartData: []
        }
        
        const step = 86400000 // 1 day in milliseconds
        for (let i = start; i <= end; i += step) {
          const date = dayjs(i).format('YYYY-MM-DD')
          const dateData = rows.find(x => x.date === date)
            || { date, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
          
          result.promptTokens += Number(dateData.promptTokens) || 0
          result.completionTokens += Number(dateData.completionTokens) || 0
          result.totalTokens += Number(dateData.totalTokens) || 0
          result.chartData.push({
            id: date,
            ...dateData
          })
        }
        
        resolve(result)
      }
    })
  })
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
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 更新聊天室状态
      db.run('UPDATE chat_room SET status = ? WHERE userId = ? AND status = ?', 
        [Status.Deleted, userId, Status.Normal])
      
      // 更新相关聊天记录状态
      db.run('UPDATE chat SET status = ? WHERE roomId IN (SELECT roomId FROM chat_room WHERE userId = ?) AND status = ?',
        [Status.Deleted, userId, Status.Normal])
      
      resolve(null)
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
  room.prompt = row.prompt
  room.usingContext = row.usingContext
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
    return userInfo
  })

  return { users, total }
}

// 重命名聊天室
export async function renameChatRoom(userId: string, title: string, roomId: number) {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE chat_room SET title = ? WHERE userId = ? AND roomId = ?'
    db.run(sql, [title, userId, roomId], (err) => {
      if (err) reject(err)
      else resolve(null)
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
    const sql = 'UPDATE user SET name = ?, description = ?, avatar = ? WHERE id = ?'
    db.run(sql, [user.name, user.description, user.avatar, Number(userId)], (err) => {
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

// 更新聊天室思考开关
export async function updateRoomUsingThinking(userId: string, roomId: number, using: boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE chat_room SET usingThinking = ? WHERE userId = ? AND roomId = ?'
    db.run(sql, [using, userId, roomId], function(err) {
      if (err) reject(err)
      else resolve(this.changes > 0)
    })
  })
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
