/**
 * 人设（dsh-peach-persona）· 宿主半侧
 *
 * 干什么：把 agent 人设从 profile 的 preset 覆盖里搬出来，改成读一个 Markdown
 * 文件，每轮装配时注册成系统提示词里的一段；并把「这一轮到底注入了什么」记下来。
 *
 * 为什么这么写（都是踩过的坑）：
 * 1. 服务一律用 ctx.get() 可选获取 + undefined 守卫，**不写 inject 硬依赖**。
 *    inject 里写了 webServer，一旦某个模式没有这个服务，整行加载失败 → 启动失败。
 *    这个人设插件不值得握有「让 GUI 起不来」的权力。
 * 2. apply() 里每一步都 try/catch。最坏结果必须是「人设没注入」，不是「进程挂了」。
 * 3. 正文里的 {{名字}} 只放行已注册的模板变量（model / provider / cwd），其余降级成
 *    {名字}：未注册的变量会让整轮渲染抛错，那会把一次正常对话变成一次失败。
 * 4. 空文件 / 文件不存在 → 注入空串，等于不注入，不会污染提示词。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS, readFields, renderPersona, writeFields } from './fields.js'

const PERSONA_FILE_NAME = 'persona.md'
const SECTION_NAME = 'peach:persona'
const SECTION_ORDER = 1
// 后段紧跟在原 `persona-suffix`（10200）之后；用 10201 而不是 10200，
// 是因为同一层里重复的 order 有抛错风险，而顺序上差 1 没有实际差别。
const SECTION_NAME_TAIL = 'peach:persona-tail'
const SECTION_ORDER_TAIL = 10201
const API_PREFIX = '/api/peach-persona'
const MAX_PERSONA_CHARS = 200_000
const LOG_KEEP_LINES = 400

// 宿主注册过的模板变量；其余一律降级，防止渲染抛错。
const SAFE_VARS = new Set(['model', 'provider', 'cwd'])

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv
  return path.join(os.homedir(), '.dsh')
}
const personaDir = () => path.join(dshHome(), 'persona')
const personaPath = () => path.join(personaDir(), PERSONA_FILE_NAME)
// 字段表是编辑源；persona.md 是它渲染出来的产物（注入仍然只读 .md）。
const jsonPath = () => path.join(personaDir(), 'persona.json')
const logPath = () => path.join(personaDir(), 'inject.jsonl')

/** 未知模板变量降级：{{xxx}} → {xxx}，避免整轮渲染失败。 */
function sanitize(text) {
  return String(text).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, name) =>
    SAFE_VARS.has(name) ? whole : `{${name}}`,
  )
}

function sha12(text) {
  // 只用于「两份文本是否同一份」的比对，不是安全用途。
  let h = 0
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return `${s.length.toString(16)}-${(h >>> 0).toString(16)}`
}

function appendLine(file, record) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8')
    // 只保留尾部若干行，避免日志无限长。
    const all = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '')
    if (all.length > LOG_KEEP_LINES) {
      fs.writeFileSync(file, `${all.slice(-LOG_KEEP_LINES).join('\n')}\n`, 'utf8')
    }
  } catch {
    // 记不下来不能影响对话。
  }
}

function readLog(limit = 10) {
  try {
    return fs
      .readFileSync(logPath(), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return { raw: l }
        }
      })
  } catch {
    return []
  }
}

/** 读请求体（带上限，超了就 413，不要默默截断）。 */
function readBody(req, limit = MAX_PERSONA_CHARS + 64_000) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export const name = 'peach-persona'

// 必须声明依赖，让 Cordis **等到服务就绪**再激活本行。
//
// 教训：早先为了「别让 GUI 起不来」故意不写 inject、改用 ctx.get() 可选获取。
// 结果装包时靠 HMR 在已运行的树上激活，一切正常；**冷启动时两个服务都还没就绪**，
// ctx.get() 双双返回 undefined，于是人设段和 HTTP 路由一起静默消失。
// 可选获取不等于「等依赖」，只等于「依赖没有就跳过」——这不是我要的语义。
export const inject = ['systemPrompt', 'webServer']
export function apply(ctx) {
  const warn = (msg) => {
    try {
      console.error(`[peach-persona] ${msg}`)
    } catch {
      /* 无控制台也不能出事 */
    }
  }

  // ── 人设文件读取（按 mtime + size 缓存，避免每步都读盘） ────────────────
  const cache = { text: '', head: '', tail: '', sha: '', mtimeMs: -1, size: -1, missing: true }

  function loadPersona() {
    const file = personaPath()
    try {
      const st = fs.statSync(file)
      if (st.mtimeMs !== cache.mtimeMs || st.size !== cache.size) {
        const raw = fs.readFileSync(file, 'utf8')
        // 一个只有 `---` 的行把人设切成两段：
        //   前段 → order 1（人设前缀位，第一方指导之前）
        //   后段 → order 10201（第一方指导之后，等同原来的 persona-suffix 位）
        // 没写分隔行就整段当人设，行为可预期。
        const rows = raw.split(/\r?\n/)
        const cut = rows.findIndex((row) => row.trim() === '---')
        const headRaw = cut === -1 ? raw : rows.slice(0, cut).join('\n')
        const tailRaw = cut === -1 ? '' : rows.slice(cut + 1).join('\n')
        cache.head = sanitize(headRaw).slice(0, MAX_PERSONA_CHARS)
        cache.tail = sanitize(tailRaw).slice(0, MAX_PERSONA_CHARS)
        cache.text = cache.tail.trim() === '' ? cache.head : `${cache.head}\n\n${cache.tail}`
        cache.sha = sha12(cache.text)
        cache.mtimeMs = st.mtimeMs
        cache.size = st.size
        cache.missing = false
      }
    } catch {
      cache.text = ''
      cache.head = ''
      cache.tail = ''
      cache.sha = ''
      cache.mtimeMs = -1
      cache.size = -1
      cache.missing = true
    }
    return cache
  }

  function ensurePersonaFile() {
    const file = personaPath()
    try {
      if (fs.existsSync(file)) return false
      fs.mkdirSync(personaDir(), { recursive: true })
      // 只按字段渲染；没有字段表就是空人设，**不写文件**。
      // 出厂不带任何预设人设：这是给别人用的插件，不能把作者自己的人设塞给装它的人。
      const seed = renderPersona(readFields(jsonPath()) ?? {})
      if (seed.trim() === '') return false
      fs.writeFileSync(file, seed, 'utf8')
      appendLine(logPath(), { at: new Date().toISOString(), kind: 'seed', file, chars: seed.length })
      return true
    } catch (error) {
      warn(`创建人设文件失败: ${String((error && error.message) || error)}`)
      return false
    }
  }

  // ── 注入记录：只在渲染文本变化时追加一行 ────────────────────────────────
  let lastLoggedSha = ''
  let lastInjected = null

  function noteInjection(text, sha) {
    const now = new Date().toISOString()
    lastInjected = { at: now, chars: text.length, sha, file: personaPath(), missing: cache.missing }
    if (sha === lastLoggedSha) return
    lastLoggedSha = sha
    appendLine(logPath(), {
      at: now,
      kind: cache.missing ? 'missing' : 'inject',
      chars: text.length,
      sha,
      file: personaPath(),
      mtimeMs: cache.mtimeMs,
    })
  }

  ensurePersonaFile()

  // ── 1. 注册系统提示词段 ────────────────────────────────────────────────
  try {
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt === undefined) {
      warn('没有 systemPrompt 服务，人设不会注入')
    } else {
      ctx.effect(
        () =>
          systemPrompt.section({
            name: SECTION_NAME,
            order: SECTION_ORDER,
            text: () => {
              const st = loadPersona()
              noteInjection(st.text, st.sha)
              return st.head
            },
          }),
        'peach-persona: prompt section (head)',
      )
      ctx.effect(
        () =>
          systemPrompt.section({
            name: SECTION_NAME_TAIL,
            order: SECTION_ORDER_TAIL,
            text: () => loadPersona().tail,
          }),
        'peach-persona: prompt section (tail)',
      )
    }
  } catch (error) {
    warn(`注册提示词段失败: ${String((error && error.message) || error)}`)
  }

  // ── 2. 设置页用的同源 API ──────────────────────────────────────────────
  try {
    const webServer = ctx.get('webServer')
    if (webServer === undefined) {
      warn('没有 webServer 服务，设置页取不到数据')
    } else {
      ctx.effect(
        () =>
          webServer.register({
            kind: 'prefix',
            path: API_PREFIX,
            handler: async (req, res) => {
              const route = (req.url ?? '').split('?')[0].slice(API_PREFIX.length) || '/'
              const send = (status, body) => {
                const bytes = Buffer.from(JSON.stringify(body), 'utf8')
                res.writeHead(status, {
                  'content-type': 'application/json; charset=utf-8',
                  'content-length': String(bytes.length),
                  'cache-control': 'no-store',
                })
                res.end(bytes)
              }
              try {
                if (route === '/state' && req.method === 'GET') {
                  const st = loadPersona()
                  // 设置页编辑要的是**原文**，不是注入用的降级版：
                  // 把 {{model}} 这类已注册变量原样交回去，保存时才不会把它改写成 {model}。
                  let raw = ''
                  try {
                    raw = fs.readFileSync(personaPath(), 'utf8')
                  } catch {
                    raw = ''
                  }
                  const stat = (() => {
                    try {
                      return fs.statSync(personaPath())
                    } catch {
                      return null
                    }
                  })()
                  const fields = readFields(jsonPath()) ?? { ...DEFAULTS }
                  send(200, {
                    ok: true,
                    file: personaPath(),
                    dir: personaDir(),
                    logFile: logPath(),
                    missing: st.missing,
                    chars: st.text.length,
                    sha: st.sha,
                    mtime: stat ? new Date(stat.mtimeMs).toISOString() : null,
                    lastInjected,
                    text: raw,
                    // 设置页表单用的是字段，不是整段文本；字段缺失时给默认值，表单不会空着。
                    fields,
                    // md 被外部改过（与字段渲染结果不一致）时提示，别让人以为表单就是全部真相。
                    drift: !st.missing && raw !== renderPersona(fields),
                    jsonFile: jsonPath(),
                    log: readLog(12),
                    section: { name: SECTION_NAME, order: SECTION_ORDER },
                  })
                  return
                }

                if (route === '/preview' && req.method === 'POST') {
                  // 让表单能看到「这些字段最终会渲染成什么」，不用先保存。
                  const body = await readBody(req)
                  const parsed = JSON.parse(body || '{}')
                  send(200, { ok: true, text: renderPersona(parsed.fields ?? {}) })
                  return
                }

                if (route === '/save' && req.method === 'POST') {
                  const body = await readBody(req)
                  const parsed = JSON.parse(body || '{}')
                  let text
                  if (parsed && typeof parsed.fields === 'object' && parsed.fields !== null) {
                    // 结构化保存：先落字段表，再由字段渲染出注入用的 .md。
                    const normalized = writeFields(jsonPath(), parsed.fields)
                    text = renderPersona(normalized)
                  } else {
                    text = String(parsed.text ?? '')
                  }
                  if (text.length > MAX_PERSONA_CHARS) {
                    send(413, { ok: false, error: `人设超过 ${MAX_PERSONA_CHARS} 字符` })
                    return
                  }
                  const file = personaPath()
                  fs.mkdirSync(personaDir(), { recursive: true })
                  try {
                    const previous = fs.readFileSync(file, 'utf8')
                    if (previous.trim() !== '') {
                      fs.writeFileSync(`${file}.bak`, previous, 'utf8')
                    }
                  } catch {
                    // 没旧内容或读不到，都不影响保存
                  }
                  const tmp = `${file}.tmp-${process.pid}`
                  fs.writeFileSync(tmp, text, 'utf8')
                  fs.renameSync(tmp, file)
                  // 让下一次装配一定重读
                  cache.mtimeMs = -1
                  cache.size = -1
                  appendLine(logPath(), {
                    at: new Date().toISOString(),
                    kind: 'save',
                    chars: text.length,
                    sha: sha12(sanitize(text)),
                    file,
                  })
                  send(200, { ok: true, file, chars: text.length })
                  return
                }

                send(404, { ok: false, error: `未知路由 ${route}` })
              } catch (error) {
                send(error && error.status ? error.status : 500, {
                  ok: false,
                  error: String((error && error.message) || error),
                })
              }
            },
          }),
        'peach-persona: settings api',
      )
    }
  } catch (error) {
    warn(`注册 HTTP 路由失败: ${String((error && error.message) || error)}`)
  }
}
