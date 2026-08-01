import express from 'express'
import jwt from 'jsonwebtoken'
import * as dotenv from 'dotenv'
import { textTokens } from 'gpt-token'
import type { RequestProps } from './types'
import type { ChatMessage } from './chatgpt'
import { abortChatProcess, chatConfig, chatReplyProcess, generateChatTitle, listModelsForKey } from './chatgpt'
import { auth, getUserId } from './middleware/auth'
import { clearApiKeyCache, clearConfigCache, getApiKeys, getCacheApiKeys, getCacheConfig, getOriginConfig, normalizeMailConfig } from './storage/config'
import { Status, UsageResponse, UserRole, UserConfig, chatModelOptions, KeyConfig } from './storage/model'
import type { ChatInfo, ChatOptions, Config, MailConfig, SiteConfig, UserInfo, UserOption } from './storage/model'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { createXXHash64 } from 'hash-wasm'
import {
  clearChat,
  createChatRoom,
  createUser,
  deleteAllChatRooms,
  deleteChat,
  deleteChatRoom,
  existsChatRoom,
  getChatRoom,
  getChatRooms,
  getChats,
  getChat,
  getKeys,
  getUser,
  getUserById,
  getUserStatisticsByDay,
  getUsers,
  updateChat,
  insertChat,
  insertChatUsage,
  renameChatRoom,
  updateApiKeyStatus,
  updateConfig,
  updateRoomChatModel,
  updateAutomaticRoomTitle,
  updateRoomPrompt,
  updateRoomUsingContext,
  updateRoomUsingDraw,
  updateUser,
  updateUserInfo,
  updateUserPassword,
  updateUserStatus,
  updateUserVisitTime,
  upsertKey,
  verifyUser,
} from './storage/sqlite'
import { authLimiter, limiter } from './middleware/limiter'
import { hasAnyRole, isEmail, isNotEmptyString } from './utils/is'
import { sendNoticeMail, sendResetPasswordMail, sendTestMail, sendVerifyMail, sendVerifyMailAdmin } from './utils/mail'
import { checkUserResetPassword, checkUserVerify, checkUserVerifyAdmin, getUserResetPasswordUrl, getUserVerifyUrl, getUserVerifyUrlAdmin, md5 } from './utils/security'
import { rootAuth } from './middleware/rootAuth'
import type { AuthJwtPayload } from './types'
import {
  getPluginListForUser,
  initializePlugins,
  savePluginSettings,
  setPluginEnabledForUser,
  setPluginPublished,
} from './plugins'

dotenv.config()

const app = express()
const router = express.Router()

function normalizeRoomTitle(value: string, maxLength = 40): string {
  return String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^[\s#*`'"“”「」『』《》]+|[\s#*`'"“”「」『』《》。！？.!?]+$/g, '')
    .replace(/^(?:标题|会话标题|title)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function buildFallbackRoomTitle(prompt: string): string {
  return normalizeRoomTitle(prompt, 30) || '新对话'
}

app.use(express.static('public'))
app.use(express.json())

// Select the closest supported tokenizer model for estimating token counts
function mapModelForTokenizer(model?: string): string {
  if (!model) return 'gpt-3.5-turbo'
  const m = model.toLowerCase()
  if (m.startsWith('gpt-4')) return 'gpt-4'
  if (m.startsWith('gpt-3.5')) return 'gpt-3.5-turbo'
  // OpenAI o-series models use a different BPE; approximate with gpt-4
  if (m.includes('gpt-4o') || m.includes('o3')) return 'gpt-4'
  // Fallback for non-OpenAI models (Claude/Gemini etc.)
  return 'gpt-3.5-turbo'
}

app.all('*', (_, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'authorization, Content-Type')
  res.header('Access-Control-Allow-Methods', '*')
  next()
})

// ---- Uploads static dir and multer setup ----
const UPLOAD_DIR = './uploads'
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }) } catch {}
app.use('/uploads', express.static(UPLOAD_DIR))
app.use('/api/uploads', express.static(UPLOAD_DIR))

const ALLOWED_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

function fileFilter(_req: any, file: any, cb: any) {
  if (ALLOWED_MIME[file.mimetype]) {
    cb(null, true)
  } else {
    cb(new Error('仅支持 png/jpeg/webp/gif 图片 | Only png/jpeg/webp/gif images are allowed'), false)
  }
}

const storage: multer.StorageEngine = {
  _handleFile(_req: any, file: any, cb: any) {
    (async () => {
      const ext = ALLOWED_MIME[file.mimetype] || '.png'
      const tmpName = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
      const tmpPath = path.join(UPLOAD_DIR, tmpName)
      const out = fs.createWriteStream(tmpPath)
      const hasher = await createXXHash64()
      let size = 0
      file.stream.on('data', (chunk: any) => { hasher.update(chunk); size += chunk.length })
      out.on('error', (err) => cb(err))
      out.on('finish', () => {
        const digest = hasher.digest()
        const finalName = `${digest}${ext}`
        const finalPath = path.join(UPLOAD_DIR, finalName)
        fs.promises.access(finalPath)
          .then(() => fs.promises.unlink(tmpPath))
          .catch(() => fs.promises.rename(tmpPath, finalPath))
          .then(() => cb(null, { destination: UPLOAD_DIR, filename: finalName, path: finalPath, size }))
          .catch((err) => cb(err))
      })
      file.stream.pipe(out)
    })().catch(err => cb(err))
  },
  _removeFile(_req: any, file: any, cb: any) {
    const p = file?.path
    if (!p) return cb(null)
    fs.unlink(p, () => cb(null))
  },
}
const upload = multer({ storage, fileFilter, limits: { fileSize: Number(process.env.UPLOAD_MAX_SIZE_MB || 10) * 1024 * 1024 } })

function buildAbsoluteUrl(u: string): string {
  try {
    if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) return u
    const isUploads = (p: string) => p.startsWith('/uploads/') || p.startsWith('./uploads/') || p.startsWith('uploads/')
    const normalizeUploads = (p: string) => `/uploads/${path.basename(p)}`
    if (isUploads(u)) {
      const siteDomain = (globalThis as any).__siteDomainCache || undefined
      // lazy cache site domain
      if (!siteDomain) {
        getCacheConfig().then(cfg => { (globalThis as any).__siteDomainCache = cfg?.siteConfig?.siteDomain })
      }
      const domain = (globalThis as any).__siteDomainCache
      if (domain && (domain.startsWith('http://') || domain.startsWith('https://')))
        return `${domain}${normalizeUploads(u)}`
      // fallback: try origin-relative
      return normalizeUploads(u)
    }
    return u
  }
  catch { return u }
}

async function toDataUrlIfLocal(u: string): Promise<string> {
  const isUploads = (p: string) => p.startsWith('/uploads/') || p.startsWith('./uploads/') || p.startsWith('uploads/')
  if (u && isUploads(u)) {
    try {
      const name = path.basename(u)
      const filePath = path.join(UPLOAD_DIR, name)
      const ext = path.extname(name).toLowerCase()
      const mime = ext === '.png'
        ? 'image/png'
        : (ext === '.jpg' || ext === '.jpeg')
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : 'application/octet-stream'
      const buf = await fs.promises.readFile(filePath)
      return `data:${mime};base64,${buf.toString('base64')}`
    }
    catch {
      return u
    }
  }
  return u
}

// 单文件上传（字段名：file）
router.post('/upload-image', auth, upload.single('file'), async (req, res) => {
  try {
    const file: any = (req as any).file
    if (!file) {
      res.send({ status: 'Fail', message: 'No file uploaded', data: null })
      return
    }
    const url = `/uploads/${file.filename}`
    res.send({ status: 'Success', message: null, data: { url, urls: [url] } })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error?.message || String(error), data: null })
  }
})

// 多文件上传（字段名：files）
router.post('/upload-images', auth, upload.array('files', 10), async (req, res) => {
  try {
    const files: any[] = (req as any).files
    if (!files || files.length === 0) {
      res.send({ status: 'Fail', message: 'No files uploaded', data: null })
      return
    }
    const urls: string[] = []
    for (const f of files) {
      urls.push(`/uploads/${f.filename}`)
    }
    res.send({ status: 'Success', message: null, data: { urls } })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error?.message || String(error), data: null })
  }
})

// ---- Uploads cleaner (optional) ----
const CLEAN_INTERVAL_MIN = Number(process.env.UPLOAD_CLEAN_INTERVAL || 60) // minutes
const RETENTION_HOURS = Number(process.env.UPLOAD_SAVE_HOURS || 24)
if (CLEAN_INTERVAL_MIN > 0) {
  setInterval(() => {
    try {
      const now = Date.now()
      const expiry = now - RETENTION_HOURS * 60 * 60 * 1000
      fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) return
        files.forEach((f) => {
          const full = path.join(UPLOAD_DIR, f)
          fs.stat(full, (e, st) => {
            if (e) return
            if (st.isFile() && st.mtimeMs < expiry) {
              fs.unlink(full, () => {})
            }
          })
        })
      })
    }
    catch {}
  }, CLEAN_INTERVAL_MIN * 60 * 1000)
}

router.get('/chatrooms', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const rooms = await getChatRooms(userId)
    const result = []

    rooms.forEach((r) => {
      const item = {
        uuid: r.roomId,
        title: r.title,
        titleSource: r.titleSource,
        isEdit: false,
        prompt: r.prompt,
        usingContext: r.usingContext === undefined ? true : r.usingContext,
        usingDraw: r.usingDraw === undefined ? false : r.usingDraw,
        chatModel: (r.chatModel === undefined || r.chatModel === null) ? 'gpt-3.5-turbo' : r.chatModel,
      }
      result.push(item)
      // console.error(`roomid:${item.uuid}, title:${item.title}, model:${item.chatModel}`)
    })
    res.send({ status: 'Success', message: null, data: result })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Load error', data: [] })
  }
})

router.post('/room-create', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const { title, roomId, chatModel } = req.body as { title: string; roomId: number; chatModel: string }
    const room = await createChatRoom(userId, title, roomId, chatModel)
    res.send({ status: 'Success', message: null, data: room })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Create error', data: null })
  }
})

router.post('/room-rename', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const { title, roomId } = req.body as { title: string; roomId: number }
    const normalizedTitle = normalizeRoomTitle(title, 80)
    if (!normalizedTitle) {
      res.send({ status: 'Fail', message: '标题不能为空', data: null })
      return
    }
    const updated = await renameChatRoom(userId, normalizedTitle, roomId)
    if (!updated) {
      res.send({ status: 'Fail', message: '会话不存在', data: null })
      return
    }
    res.send({ status: 'Success', message: null, data: { title: normalizedTitle, titleSource: 'manual' } })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Rename error', data: null })
  }
})

router.post('/room-title', auth, async (req, res) => {
  try {
    const userId = String(req.headers.userId || '')
    const { roomId, prompt, response } = req.body as { roomId: number; prompt: string; response: string }
    const room = await getChatRoom(userId, roomId)
    if (!room) {
      res.send({ status: 'Fail', message: '会话不存在', data: null })
      return
    }
    if (room.titleSource !== 'placeholder') {
      res.send({ status: 'Success', message: null, data: { title: room.title, titleSource: room.titleSource } })
      return
    }

    const fallbackTitle = buildFallbackRoomTitle(prompt)
    const config = await getCacheConfig()
    const titleModel = String(config.siteConfig?.titleModel || '').trim()
    let title = fallbackTitle
    let titleSource: 'fallback' | 'generated' = 'fallback'

    if (titleModel) {
      try {
        const user = await getUserById(userId)
        const generatedTitle = normalizeRoomTitle(await generateChatTitle(user, titleModel, String(prompt || ''), String(response || '')))
        if (generatedTitle) {
          title = generatedTitle
          titleSource = 'generated'
        }
      }
      catch (error) {
        globalThis.console.warn('生成会话标题失败，已使用本地标题:', error)
      }
    }

    const updated = await updateAutomaticRoomTitle(userId, title, roomId, titleSource)
    if (!updated) {
      const latestRoom = await getChatRoom(userId, roomId)
      res.send({ status: 'Success', message: null, data: { title: latestRoom?.title || title, titleSource: latestRoom?.titleSource || titleSource } })
      return
    }
    res.send({ status: 'Success', message: null, data: { title, titleSource } })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error?.message || '标题生成失败', data: null })
  }
})

router.post('/room-prompt', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const { prompt, roomId } = req.body as { prompt: string; roomId: number }
    const success = await updateRoomPrompt(userId, roomId, prompt)
    if (success)
      res.send({ status: 'Success', message: 'Saved successfully', data: null })
    else
      res.send({ status: 'Fail', message: 'Saved Failed', data: null })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Rename error', data: null })
  }
})

router.post('/room-chatmodel', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const { model, roomId } = req.body as { model: string; roomId: number }
    const success = await updateRoomChatModel(userId, roomId, model)
    if (success)
      res.send({ status: 'Success', message: `Saved successfully, ${roomId}, chatModel: ${model}`, data: null })
    else
      res.send({ status: 'Fail', message: `Saved Failed, roomid: ${roomId}, chatModel: ${model}`, data: null })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Rename error', data: null })
  }
})

router.post('/room-context', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const { using, roomId } = req.body as { using: boolean; roomId: number }
    const success = await updateRoomUsingContext(userId, roomId, using)
    if (success)
      res.send({ status: 'Success', message: 'Saved successfully', data: null })
    else
      res.send({ status: 'Fail', message: 'Saved Failed', data: null })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Rename error', data: null })
  }
})

router.post('/room-draw', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const { using, roomId } = req.body as { using: boolean; roomId: number }
    if (!roomId || !await existsChatRoom(userId, roomId)) {
      res.send({ status: 'Fail', message: 'Unknow room', data: null })
      return
    }
    await updateRoomUsingDraw(userId, roomId, using)
    res.send({ status: 'Success', message: null, data: null })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Update error', data: null })
  }
})

router.post('/room-delete', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const { roomId } = req.body as { roomId: number }
    if (!roomId || !await existsChatRoom(userId, roomId)) {
      res.send({ status: 'Fail', message: 'Unknow room', data: null })
      return
    }
    await deleteChatRoom(userId, roomId)
    res.send({ status: 'Success', message: null })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Delete error', data: null })
  }
})

router.get('/chat-history', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const roomId = +req.query.roomId
    const lastId = req.query.lastId as string
    if (!roomId || !await existsChatRoom(userId, roomId)) {
      res.send({ status: 'Success', message: null, data: [] })
      // res.send({ status: 'Fail', message: 'Unknow room', data: null })
      return
    }
    const chats = await getChats(roomId, !isNotEmptyString(lastId) ? null : parseInt(lastId))

    const result = []
    chats.forEach((c) => {
      if (c.status !== Status.InversionDeleted) {
        result.push({
          uuid: c.uuid,
          dateTime: c.dateTime,
          text: c.prompt,
          inversion: true,
          error: false,
          conversationOptions: null,
          requestOptions: {
            prompt: c.prompt,
            options: null,
          },
        })
      }
      if (c.status !== Status.ResponseDeleted) {
        const usage = c.options.completion_tokens
          ? {
              completion_tokens: c.options.completion_tokens || null,
              prompt_tokens: c.options.prompt_tokens || null,
              total_tokens: c.options.total_tokens || null,
              estimated: c.options.estimated || null,
            }
          : undefined
        result.push({
          uuid: c.uuid,
          dateTime: c.dateTime,
          text: c.response,
          inversion: false,
          error: false,
          loading: false,
          responseCount: (c.previousResponse?.length ?? 0) + 1,
          thinking: c.options?.thinking || '',
          thinkingExpanded: false,
          conversationOptions: {
            parentMessageId: c.options.messageId,
            conversationId: c.options.conversationId,
          },
          requestOptions: {
            prompt: c.prompt,
            parentMessageId: c.options.parentMessageId,
            options: {
              parentMessageId: c.options.messageId,
              conversationId: c.options.conversationId,
            },
          },
          usage,
        })
      }
    })

    res.send({ status: 'Success', message: null, data: result })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Load error', data: null })
  }
})

router.get('/chat-response-history', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const roomId = +req.query.roomId
    const uuid = +req.query.uuid
    const index = +req.query.index
    if (!roomId || !await existsChatRoom(userId, roomId)) {
      res.send({ status: 'Success', message: null, data: [] })
      // res.send({ status: 'Fail', message: 'Unknow room', data: null })
      return
    }
    const chat = await getChat(roomId, uuid)
    if (chat.previousResponse === undefined || chat.previousResponse.length < index) {
      res.send({ status: 'Fail', message: 'Error', data: [] })
      return
    }
    const response = index >= chat.previousResponse.length
      ? chat
      : chat.previousResponse[index]
    const usage = response.options.completion_tokens
      ? {
          completion_tokens: response.options.completion_tokens || null,
          prompt_tokens: response.options.prompt_tokens || null,
          total_tokens: response.options.total_tokens || null,
          estimated: response.options.estimated || null,
        }
      : undefined
    res.send({
      status: 'Success',
      message: null,
      data: {
        uuid: chat.uuid,
        dateTime: chat.dateTime,
        text: response.response,
        inversion: false,
        error: false,
        loading: false,
        responseCount: (chat.previousResponse?.length ?? 0) + 1,
        thinking: response.options?.thinking || '',
        thinkingExpanded: false,
        conversationOptions: {
          parentMessageId: response.options.messageId,
          conversationId: response.options.conversationId,
        },
        requestOptions: {
          prompt: chat.prompt,
          parentMessageId: response.options.parentMessageId,
          images: (chat as any)?.images || [],
          options: {
            parentMessageId: response.options.messageId,
            conversationId: response.options.conversationId,
          },
        },
        usage,
      },
    })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Load error', data: null })
  }
})

router.post('/chat-delete', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const { roomId, uuid, inversion } = req.body as { roomId: number; uuid: number; inversion: boolean }
    if (!roomId || !await existsChatRoom(userId, roomId)) {
      res.send({ status: 'Fail', message: 'Unknow room', data: null })
      return
    }
    await deleteChat(roomId, uuid, inversion)
    res.send({ status: 'Success', message: null, data: null })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Delete error', data: null })
  }
})

router.post('/chat-clear-all', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    await deleteAllChatRooms(userId)
    res.send({ status: 'Success', message: null, data: null })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Delete error', data: null })
  }
})

router.post('/chat-clear', auth, async (req, res) => {
  try {
    const userId = req.headers.userId as string
    const { roomId } = req.body as { roomId: number }
    if (!roomId || !await existsChatRoom(userId, roomId)) {
      res.send({ status: 'Fail', message: 'Unknow room', data: null })
      return
    }
    await clearChat(roomId)
    res.send({ status: 'Success', message: null, data: null })
  }
  catch (error) {
    console.error(error)
    res.send({ status: 'Fail', message: 'Delete error', data: null })
  }
})

router.post('/chat-process', [auth, limiter], async (req, res) => {
  res.setHeader('Content-type', 'application/octet-stream')

  let { roomId, uuid, regenerate, prompt, images = [], options = {}, systemMessage, temperature, top_p, draw, autoContinue } = req.body as RequestProps
  const userId = req.headers.userId as string
  const room = await getChatRoom(userId, roomId)
  if (room == null)
    global.console.error(`Unable to get chat room \t ${userId}\t ${roomId}`)
  if (room != null && isNotEmptyString(room.prompt))
    systemMessage = room.prompt
  let lastResponse
  let result
  let message: ChatInfo
  try {
    const userId = req.headers.userId.toString()
    const user = await getUserById(userId)

    // 若携带图片，写入用户消息时附加 Markdown 以便历史可视
    let userTextForInsert = prompt
    if (!regenerate && Array.isArray(images) && images.length > 0) {
      const attachmentsMarkdown = images.map((u: string) => `![image](${buildAbsoluteUrl(u)})`).join('\n')
      userTextForInsert = attachmentsMarkdown ? `${prompt}\n\n${attachmentsMarkdown}` : prompt
    }
    message = regenerate
      ? await getChat(roomId, uuid)
      : await insertChat(uuid, userTextForInsert, roomId, options as ChatOptions, images)
    let firstChunk = true
    // 如有图片，将其转换为 visionContent 传入底层，复用统一流式输出逻辑
    let visionContent: any[] | undefined
    const effectiveImages = (Array.isArray(images) && images.length > 0)
      ? images
      : ((message as any)?.images || [])
    if (Array.isArray(effectiveImages) && effectiveImages.length > 0) {
      const content: any[] = [{ type: 'text', text: prompt }]
      for (const u of effectiveImages) {
        const maybeData = await toDataUrlIfLocal(u)
        const finalUrl = (maybeData.startsWith('data:'))
          ? maybeData
          : (String(u).startsWith('/uploads/')
            ? `${req.protocol}://${req.get('host')}${u}`
            : buildAbsoluteUrl(maybeData))
        content.push({ type: 'image_url', image_url: { url: finalUrl } })
      }
      visionContent = content
    }

    result = await chatReplyProcess({
      message: prompt,
      visionContent,
      lastContext: options,
      process: (chat: ChatMessage) => {
        lastResponse = chat
        const chuck = {
          id: chat.id,
          conversationId: chat.conversationId,
          text: chat.text,
          ...(chat.toolStatus ? { toolStatus: chat.toolStatus } : {}),
          // Stream incremental reasoning content if provided
          ...(chat.thinking ? { thinking: chat.thinking } : {}),
          detail: {
            choices: [
              {
                finish_reason: undefined,
              },
            ],
          },
        }
        if (chat.detail && chat.detail.choices.length > 0)
          chuck.detail.choices[0].finish_reason = chat.detail.choices[0].finish_reason

        res.write(firstChunk ? JSON.stringify(chuck) : `\n${JSON.stringify(chuck)}`)
        firstChunk = false
      },
      systemMessage,
      temperature,
      top_p,
      user,
      messageId: message.id.toString(),
      chatUuid: uuid,
      tryCount: 0,
      room,
      draw,
      autoContinue,
    })
      
    // return the whole response including usage
    if (!result.data.detail?.usage) {
      if (!result.data.detail)
        result.data.detail = {}
      result.data.detail.usage = new UsageResponse()
      // 使用更贴近当前模型的分词器做估算，无法精确时回退到 gpt-3.5
      const tokenizerModel = mapModelForTokenizer(room?.chatModel)
      result.data.detail.usage.prompt_tokens = textTokens(prompt, tokenizerModel as any)
      result.data.detail.usage.completion_tokens = textTokens(result.data.text, tokenizerModel as any)
      result.data.detail.usage.total_tokens = result.data.detail.usage.prompt_tokens + result.data.detail.usage.completion_tokens
      result.data.detail.usage.estimated = true
    }
    else {
      // usage 存在但字段缺失时进行补全估算，避免出现空值
      const u = result.data.detail.usage as UsageResponse & Record<string, any>
      const tokenizerModel = mapModelForTokenizer(room?.chatModel)
      const needEstimate = (u.prompt_tokens == null) || (u.completion_tokens == null) || (u.total_tokens == null)
      if (needEstimate) {
        u.prompt_tokens = u.prompt_tokens ?? textTokens(prompt, tokenizerModel as any)
        u.completion_tokens = u.completion_tokens ?? textTokens(result.data.text, tokenizerModel as any)
        u.total_tokens = u.total_tokens ?? (u.prompt_tokens + u.completion_tokens)
        u.estimated = true
      }
    }

    // Include final full reasoning content if available
    res.write(`\n${JSON.stringify(result.data)}`)
  }
  catch (error) {
    res.write(JSON.stringify({ message: error?.message }))
  }
  finally {
    res.end()
    try {
      if (result == null || result === undefined || result.status !== 'Success') {
        if (result && result.status !== 'Success')
          lastResponse = { text: result.message }
        result = { data: lastResponse }
      }

      if (result.data === undefined)
        // eslint-disable-next-line no-unsafe-finally
        return

      if (regenerate && message.options.messageId) {
        const previousResponse = message.previousResponse || []
        previousResponse.push({ response: message.response, options: message.options })
        await updateChat(message.id as unknown as string,
          result.data.text,
          result.data.id,
          result.data.conversationId,
          result.data.detail?.usage as UsageResponse,
          previousResponse as [],
          (result.data as any).thinking as string)
      }
      else {
        await updateChat(message.id as unknown as string,
          result.data.text,
          result.data.id,
          result.data.conversationId,
          result.data.detail?.usage as UsageResponse,
          undefined,
          (result.data as any).thinking as string)
      }

      if (result.data.detail?.usage && result.data.id) {
        await insertChatUsage(req.headers.userId,
          roomId,
          message.id,
          result.data.id,
          result.data.detail?.usage as UsageResponse)
      }
    }
    catch (error) {
      global.console.error(error)
    }
  }
})

router.post('/chat-abort', [auth, limiter], async (req, res) => {
  try {
    const userId = req.headers.userId.toString()
    const { text, messageId, conversationId, chatUuid } = req.body as { text: string; messageId: string; conversationId: string; chatUuid: number }
    const msgId = await abortChatProcess(chatUuid || userId)
    await updateChat(msgId,
      text,
      messageId,
      conversationId,
      null)
    res.send({ status: 'Success', message: 'OK', data: null })
  }
  catch (error) {
    res.send({ status: 'Fail', message: '中断失败 | Abort failed', data: null })
  }
})

router.post('/user-register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body as { username: string; password: string }
    const config = await getCacheConfig()
    if (!config.siteConfig.registerEnabled) {
      res.send({ status: 'Fail', message: '注册账号功能未启用 | Register account is disabled!', data: null })
      return
    }
    if (!isEmail(username)) {
      res.send({ status: 'Fail', message: '请输入正确的邮箱 | Please enter a valid email address.', data: null })
      return
    }
    if (isNotEmptyString(config.siteConfig.registerMails)) {
      let allowSuffix = false
      const emailSuffixs = config.siteConfig.registerMails.split(',')
      for (let index = 0; index < emailSuffixs.length; index++) {
        const element = emailSuffixs[index]
        allowSuffix = username.toLowerCase().endsWith(element)
        if (allowSuffix)
          break
      }
      if (!allowSuffix) {
        res.send({ status: 'Fail', message: '该邮箱后缀不支持 | The email service provider is not allowed', data: null })
        return
      }
    }

    const user = await getUser(username)
    if (user != null) {
      if (user.status === Status.PreVerify) {
        await sendVerifyMail(username, await getUserVerifyUrl(username))
        throw new Error('请去邮箱中验证 | Please verify in the mailbox')
      }
      if (user.status === Status.AdminVerify)
        throw new Error('请等待管理员开通 | Please wait for the admin to activate')
      res.send({ status: 'Fail', message: '账号已存在 | The email exists', data: null })
      return
    }
    const newPassword = md5(password)
    const isRoot = username.toLowerCase() === process.env.ROOT_USER
    await createUser(username, newPassword, isRoot ? [UserRole.Admin] : [UserRole.User])

    if (isRoot) {
      res.send({ status: 'Success', message: '注册成功 | Register success', data: null })
    }
    else {
      await sendVerifyMail(username, await getUserVerifyUrl(username))
      res.send({ status: 'Success', message: '注册成功, 去邮箱中验证吧 | Registration is successful, you need to go to email verification', data: null })
    }
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/config', rootAuth, async (req, res) => {
  try {
    const userId = req.headers.userId.toString()

    const user = await getUserById(userId)
    if (user == null || user.status !== Status.Normal || !user.roles.includes(UserRole.Admin))
      throw new Error('无权限 | No permission.')

    const response = await chatConfig()
    res.send(response)
  }
  catch (error) {
    res.send(error)
  }
})

  router.post('/session', async (req, res) => {
    try {
      const config = await getCacheConfig()
      const hasAuth = config.siteConfig.loginEnabled
      const allowRegister = config.siteConfig.registerEnabled
      const userId = await getUserId(req)
      // 在未登录场景下也需要定义该变量，避免后续引用未定义
      let dynamicAllModels: string[] = []
  const chatModels: {
      label
      key: string
      value: string
    }[] = []
    let userInfo: { name: string; description: string; avatar: string; userId: string; root: boolean; roles: UserRole[]; config: UserConfig }
    if (userId != null) {
      const user = await getUserById(userId)
      userInfo = {
        name: user.name,
        description: user.description,
        avatar: user.avatar,
        userId: user.id.toString(),
        root: user.roles.includes(UserRole.Admin),
        roles: user.roles,
        config: user.config ?? {},
      }

      const keys = (await getCacheApiKeys())
        .filter(d => hasAnyRole(d.userRoles, user.roles))
        .filter(d => d.status !== Status.Disabled)

      // 计算所有可用模型的并集（来自数据库持久化），为空时回退到内置静态列表
      const availableUnion = new Set<string>()
      keys.forEach((k) => {
        (k.availableModels || []).forEach((m) => availableUnion.add(m))
      })
      dynamicAllModels = Array.from(availableUnion)

      // 基于管理员勾选的模型并集生成下拉项（不追加计数后缀）
      const allowedUnion = new Set<string>()
      keys.forEach((k) => {
        (k.chatModels || []).forEach((m) => allowedUnion.add(m))
      })

      Array.from(allowedUnion).forEach((model) => {
        chatModels.push({ label: model, key: model, value: model })
      })

      updateUserVisitTime(userInfo.userId, new Date().toLocaleString())
    }

    res.send({
      status: 'Success',
      message: '',
      data: {
        auth: hasAuth,
        allowRegister,
        title: config.siteConfig.siteTitle,
        chatModels,
        // 优先使用数据库持久化的模型并集，若为空则回退到内置静态列表
        allChatModels: (function() {
          return dynamicAllModels.length
            ? dynamicAllModels.map((model) => ({ label: model, key: model, value: model }))
            : chatModelOptions
        })(),
        defaultChatModel: config.siteConfig?.defaultChatModel ?? '',
        userInfo,
      },
    })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/user-login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body as { username: string; password: string }
    if (!username || !password || !isEmail(username))
      throw new Error('用户名或密码为空 | Username or password is empty')

    const user = await getUser(username)
    if (user == null || user.password !== md5(password))
      throw new Error('用户不存在或密码错误 | User does not exist or incorrect password.')
    if (user.status === Status.PreVerify)
      throw new Error('请去邮箱中验证 | Please verify in the mailbox')
    if (user != null && user.status === Status.AdminVerify)
      throw new Error('请等待管理员开通 | Please wait for the admin to activate')
    if (user.status !== Status.Normal)
      throw new Error('账户状态异常 | Account status abnormal.')

    const config = await getCacheConfig()
    const token = jwt.sign({
      name: user.name ? user.name : user.email,
      avatar: user.avatar,
      description: user.description,
      userId: user.id.toString(),
      root: user.roles.includes(UserRole.Admin),
    } as AuthJwtPayload, config.siteConfig.loginSalt.trim())
    res.send({ status: 'Success', message: '登录成功 | Login successfully', data: { token } })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/user-send-reset-mail', authLimiter, async (req, res) => {
  try {
    const { username } = req.body as { username: string }
    if (!username || !isEmail(username))
      throw new Error('请输入格式正确的邮箱 | Please enter a correctly formatted email address.')

    const user = await getUser(username)
    if (user == null || user.status !== Status.Normal)
      throw new Error('账户状态异常 | Account status abnormal.')
    await sendResetPasswordMail(username, await getUserResetPasswordUrl(username))
    res.send({ status: 'Success', message: '重置邮件已发送 | Reset email has been sent', data: null })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/user-reset-password', authLimiter, async (req, res) => {
  try {
    const { username, password, sign } = req.body as { username: string; password: string; sign: string }
    if (!username || !password || !isEmail(username))
      throw new Error('用户名或密码为空 | Username or password is empty')
    if (!sign || !checkUserResetPassword(sign, username))
      throw new Error('链接失效, 请重新发送 | The link is invalid, please resend.')
    const user = await getUser(username)
    if (user == null || user.status !== Status.Normal)
      throw new Error('账户状态异常 | Account status abnormal.')

    updateUserPassword(user.id.toString(), md5(password))

    res.send({ status: 'Success', message: '密码重置成功 | Password reset successful', data: null })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/user-info', auth, async (req, res) => {
  try {
    const { name, avatar, description, chatModel } = req.body as UserInfo & { chatModel?: string }
    const userId = req.headers.userId.toString()

    const user = await getUserById(userId)
    if (user == null || user.status !== Status.Normal)
      throw new Error('用户不存在 | User does not exist.')
    await updateUserInfo(userId, { name, avatar, description, config: { ...(user.config ?? {}), chatModel } } as UserInfo)
    res.send({ status: 'Success', message: '更新成功 | Update successfully' })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.get('/users', rootAuth, async (req, res) => {
  try {
    const page = +req.query.page
    const size = +req.query.size
    const data = await getUsers(page, size)
    res.send({ status: 'Success', message: '获取成功 | Get successfully', data })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.get('/userOptions', rootAuth, async (req, res) => {
  try {
    const users = await getUsers(0, -1)

    const data: UserOption[] = users.users.map((user: UserInfo) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      remark: user.remark,
    }))

    res.send({ status: 'Success', message: '获取成功 | Get successfully', data })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/user-status', rootAuth, async (req, res) => {
  try {
    const { userId, status } = req.body as { userId: string; status: Status }
    const user = await getUserById(userId)
    await updateUserStatus(userId, status)
    if ((user.status === Status.PreVerify || user.status === Status.AdminVerify) && status === Status.Normal)
      await sendNoticeMail(user.email)
    res.send({ status: 'Success', message: '更新成功 | Update successfully' })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/user-edit', rootAuth, async (req, res) => {
  try {
    const { userId, email, password, roles, remark } = req.body as { userId?: string; email: string; password: string; roles: UserRole[]; remark?: string }
    if (userId) {
      await updateUser(userId, roles, password, remark)
    }
    else {
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
      if (!isEmail(normalizedEmail))
        throw new Error('请输入格式正确的邮箱 | Please enter a valid email address.')
      if (!isNotEmptyString(password))
        throw new Error('密码不能为空 | Password cannot be empty.')
      const newPassword = md5(password)
      const user = await createUser(normalizedEmail, newPassword, roles, remark)
      await updateUserStatus(user.id.toString(), Status.Normal)
    }
    res.send({ status: 'Success', message: '更新成功 | Update successfully' })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/verify', authLimiter, async (req, res) => {
  try {
    const { token } = req.body as { token: string }
    if (!token)
      throw new Error('Secret key is empty')
    const username = await checkUserVerify(token)
    const user = await getUser(username)
    if (user == null)
      throw new Error('账号不存在 | The email not exists')
    if (user.status === Status.Disabled)
      throw new Error('账号已禁用 | The email has been blocked')
    if (user.status === Status.Normal)
      throw new Error('账号已存在 | The email exists')
    if (user.status === Status.AdminVerify)
      throw new Error('请等待管理员开通 | Please wait for the admin to activate')
    if (user.status !== Status.PreVerify)
      throw new Error('账号异常 | Account abnormality')

    const config = await getCacheConfig()
    let message = '验证成功 | Verify successfully'
    if (config.siteConfig.registerReview) {
      await verifyUser(username, Status.AdminVerify)
      await sendVerifyMailAdmin(process.env.ROOT_USER, username, await getUserVerifyUrlAdmin(username))
      message = '验证成功, 请等待管理员开通 | Verify successfully, Please wait for the admin to activate'
    }
    else {
      await verifyUser(username, Status.Normal)
    }
    res.send({ status: 'Success', message, data: null })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/verifyadmin', authLimiter, async (req, res) => {
  try {
    const { token } = req.body as { token: string }
    if (!token)
      throw new Error('Secret key is empty')
    const username = await checkUserVerifyAdmin(token)
    const user = await getUser(username)
    if (user == null)
      throw new Error('账号不存在 | The email not exists')
    if (user.status !== Status.AdminVerify)
      throw new Error(`账号异常 ${user.status} | Account abnormality ${user.status}`)

    await verifyUser(username, Status.Normal)
    await sendNoticeMail(username)
    res.send({ status: 'Success', message: '账户已激活 | Account has been activated.', data: null })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/setting-base', rootAuth, async (req, res) => {
  try {
    const { apiKey, apiBaseUrl, timeoutMs, socksProxy, socksAuth, httpsProxy } = req.body as Config

    const thisConfig = await getOriginConfig()
    thisConfig.apiKey = apiKey
    thisConfig.apiBaseUrl = apiBaseUrl
    thisConfig.timeoutMs = timeoutMs
    thisConfig.socksProxy = socksProxy
    thisConfig.socksAuth = socksAuth
    thisConfig.httpsProxy = httpsProxy
    await updateConfig(thisConfig)
    clearConfigCache()
    const response = await chatConfig()
    res.send({ status: 'Success', message: '操作成功 | Successfully', data: response.data })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/setting-site', rootAuth, async (req, res) => {
  try {
    const config = req.body as SiteConfig

    const thisConfig = await getOriginConfig()
    thisConfig.siteConfig = config
    const result = await updateConfig(thisConfig)
    clearConfigCache()
    res.send({ status: 'Success', message: '操作成功 | Successfully', data: result.siteConfig })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/setting-mail', rootAuth, async (req, res) => {
  try {
    const config = normalizeMailConfig(req.body as MailConfig & { smtpTsl?: boolean })

    const thisConfig = await getOriginConfig()
    thisConfig.mailConfig = config
    const result = await updateConfig(thisConfig)
    clearConfigCache()
    res.send({ status: 'Success', message: '操作成功 | Successfully', data: result.mailConfig })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/mail-test', rootAuth, async (req, res) => {
  try {
    const config = normalizeMailConfig(req.body as MailConfig & { smtpTsl?: boolean })
    const userId = req.headers.userId as string
    const user = await getUserById(userId)
    await sendTestMail(user.email, config)
    res.send({ status: 'Success', message: '发送成功 | Successfully', data: null })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.get('/setting-keys', rootAuth, async (req, res) => {
  try {
    const result = await getApiKeys()
    res.send({ status: 'Success', message: null, data: result })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/setting-key-status', rootAuth, async (req, res) => {
  try {
    const { id, status } = req.body as { id: string; status: Status }
    await updateApiKeyStatus(id, status)
    clearApiKeyCache()
    res.send({ status: 'Success', message: '更新成功 | Update successfully' })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/setting-key-upsert', rootAuth, async (req, res) => {
  try {
    const keyConfig = req.body as KeyConfig
    await upsertKey(keyConfig)
    clearApiKeyCache()
    res.send({ status: 'Success', message: '成功 | Successfully' })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

// 获取指定密钥下的模型列表（管理员）
const handleGetKeyModels = async (req: express.Request, res: express.Response) => {
  try {
    const input = req.method === 'GET' ? req.query : req.body
    const id = String(input.id || '')
    const directKey = String(input.key || '')
    const apiBaseUrl = String(input.apiBaseUrl || '')

    let targetKey: KeyConfig | null = null
    let persistById = false

    // 优先使用前端直接传入的 key/apiBaseUrl（无需查询数据库）
    if (directKey) {
      targetKey = {
        id: undefined,
        key: directKey,
        apiBaseUrl,
        chatModels: [],
        userRoles: [],
        status: 0,
        remark: '',
      } as KeyConfig
      if (id) {
        const { getKeys } = await import('./storage/sqlite')
        const result = await getKeys()
        const savedKey = result.keys.find(key => String(key.id) === id)
        persistById = Boolean(savedKey
          && savedKey.key === directKey
          && String(savedKey.apiBaseUrl || '') === apiBaseUrl)
      }
    }
    else if (id) {
      // 兼容旧逻辑：根据 id 查询
      const { getKeys } = await import('./storage/sqlite')
      const result = await getKeys()
      const raw = result.keys.find((k: any) => String(k.id) === id)
      if (!raw) {
        res.send({ status: 'Fail', message: 'Key not found' })
        return
      }
      targetKey = raw as KeyConfig
      persistById = true
    }
    else {
      res.send({ status: 'Fail', message: 'Missing key or id' })
      return
    }

    const models = await listModelsForKey(targetKey)
    // 刷新后将模型列表持久化到数据库，便于前端统一展示
    try {
      if (id && persistById) {
        const { updateKeyAvailableModels } = await import('./storage/sqlite')
        await updateKeyAvailableModels(Number(id), models)
      }
      else if (directKey && !id) {
        const { updateKeyAvailableModelsByKey } = await import('./storage/sqlite')
        await updateKeyAvailableModelsByKey(directKey, apiBaseUrl || undefined, models)
      }
      clearApiKeyCache()
    }
    catch (persistErr) {
      // 持久化失败不影响返回模型列表，仅记录错误
      globalThis.console.warn('Persist models failed:', persistErr)
    }
    res.send({ status: 'Success', data: models })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error?.message || String(error) })
  }
}

router.post('/setting-key-models', rootAuth, handleGetKeyModels)
// 兼容已缓存的旧前端；新前端使用 POST，避免 API Key 出现在查询串和访问日志中。
router.get('/setting-key-models', rootAuth, handleGetKeyModels)

router.post('/statistics/by-day', auth, async (req, res) => {
  try {
    const requesterId = String(req.headers.userId)
    const requester = await getUserById(requesterId)
    if (!requester)
      throw new Error('用户不存在')

    const { userid = '', start, end } = req.body as { userid?: string; start: number; end: number }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
      throw new Error('统计日期范围无效')
    if (end - start > 366 * 86400000)
      throw new Error('统计日期范围不能超过 366 天')

    const admin = requester.roles?.includes(UserRole.Admin)
    let targetUserId: string | null = requesterId
    if (userid === 'all') {
      if (!admin)
        throw new Error('无权限查看全站统计')
      targetUserId = null
    }
    else if (userid && userid !== requesterId) {
      if (!admin)
        throw new Error('无权限查看其他用户统计')
      targetUserId = userid
    }

    const data = await getUserStatisticsByDay(targetUserId, start, end)
    res.send({ status: 'Success', message: '', data })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.get('/plugin/list', auth, async (req, res) => {
  try {
    const user = await getUserById(String(req.headers.userId))
    if (!user)
      throw new Error('用户不存在')
    res.send({ status: 'Success', message: '', data: await getPluginListForUser(user) })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.get('/plugin/models', auth, rootAuth, async (_req, res) => {
  try {
    const { keys } = await getKeys()
    const models = new Set<string>()
    for (const key of keys) {
      if (key.status !== Status.Normal)
        continue
      for (const model of key.availableModels || [])
        models.add(model)
    }
    res.send({ status: 'Success', message: '', data: Array.from(models).sort() })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/plugin/refresh', auth, rootAuth, async (_req, res) => {
  try {
    await initializePlugins()
    res.send({ status: 'Success', message: '', data: null })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/plugin/enabled', auth, async (req, res) => {
  try {
    const { id, enabled } = req.body as { id: string, enabled: boolean }
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id) || typeof enabled !== 'boolean')
      throw new Error('插件状态参数无效')
    const user = await getUserById(String(req.headers.userId))
    if (!user)
      throw new Error('用户不存在')
    await setPluginEnabledForUser(user, id, enabled)
    res.send({ status: 'Success', message: '', data: null })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/plugin/publish', auth, rootAuth, async (req, res) => {
  try {
    const { id, published } = req.body as { id: string, published: boolean }
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id) || typeof published !== 'boolean')
      throw new Error('插件发布参数无效')
    await setPluginPublished(id, published)
    res.send({ status: 'Success', message: '', data: null })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/plugin/settings', auth, rootAuth, async (req, res) => {
  try {
    const { id, settings } = req.body as { id: string, settings: Record<string, any> }
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id))
      throw new Error('插件设置参数无效')
    await savePluginSettings(id, settings)
    res.send({ status: 'Success', message: '', data: null })
  }
  catch (error: any) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

app.use('', router)
app.use('/api', router)

const PORT = Number(process.env.PORT) || 3002

async function startServer() {
  await initializePlugins()
  app.listen(PORT, () => globalThis.console.log(`Server is running on port ${PORT}`))
}

startServer().catch((error) => {
  globalThis.console.error('Failed to start server:', error)
  process.exitCode = 1
})
