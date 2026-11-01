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
// 成长段：不是人设，是「跟用户相处中学到的东西」。存在 growth.md，随时可追加。
// 空文件 → 不注入；上限 4000 字符，因为它是每回合的常驻成本，不能无限长。
const GROWTH_FILE_NAME = 'growth.md'
const GROWTH_SECTION = 'peach:growth'
const GROWTH_ORDER = 3
const MAX_GROWTH_CHARS = 4000
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
const growthPath = () => path.join(personaDir(), GROWTH_FILE_NAME)
// 待确认队列：提议写在这里，不注入；采纳后才搬进 growth.md。
const growthPendingPath = () => path.join(personaDir(), 'growth-pending.jsonl')
// 外部记忆源（可选）：只存「使用者点过连接」的路径，不写死任何插件。
const memorySourcesPath = () => path.join(personaDir(), 'memory-sources.json')
// 字段表是编辑源；persona.md 是它渲染出来的产物（注入仍然只读 .md）。
const jsonPath = () => path.join(personaDir(), 'persona.json')
const logPath = () => path.join(personaDir(), 'inject.jsonl')
// 锁定状态：人设设计完成后折叠成一张卡，防止手滑改掉。跟注入无关，只影响设置页。
const lockPath = () => path.join(personaDir(), 'state.json')

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

/** 读锁定状态。文件不存在 / 坏了 → 视为未锁定（不能因为一个状态文件故障就把人锁在外面）。 */
function readLock() {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath(), 'utf8'))
    return { locked: parsed?.locked === true, lockedAt: String(parsed?.lockedAt ?? '') }
  } catch {
    return { locked: false, lockedAt: '' }
  }
}

/** 写锁定状态（原子写）。失败只影响设置页的折叠，不影响注入。 */
function writeLock(next) {
  try {
    fs.mkdirSync(personaDir(), { recursive: true })
    const tmp = `${lockPath()}.tmp-${process.pid}`
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, lockPath())
    return true
  } catch {
    return false
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

  // ── 成长段读取（同样按 mtime + size 缓存） ──────────────────────────────
  // 与人设分开两个缓存：人设是「我是谁」，成长是「我学会什么」，更新节奏不同。
  const growthCache = { text: '', mtimeMs: -1, size: -1 }

  function loadGrowth() {
    try {
      const st = fs.statSync(growthPath())
      if (st.mtimeMs !== growthCache.mtimeMs || st.size !== growthCache.size) {
        const raw = fs.readFileSync(growthPath(), 'utf8')
        growthCache.text = raw.trim() === '' ? '' : raw.slice(0, MAX_GROWTH_CHARS).trim()
        growthCache.mtimeMs = st.mtimeMs
        growthCache.size = st.size
      }
    } catch {
      growthCache.text = ''
      growthCache.mtimeMs = -1
      growthCache.size = -1
    }
    return growthCache.text
  }

  // ── 成长段的写入：B（可增可删）+ C（提议先进待确认队列） ────────────────
  // 正式内容在 growth.md，一行一条 `- xxx`，头部标题行保留。
  // 提议在 growth-pending.jsonl，一行一个 JSON，**不注入**。
  // 提议只是候选：只有使用者在设置页点「采纳」，它才会被搬进 growth.md。
  // 也就是说 agent 不能自己给自己加规矩——这一条是刻意的。
  const GROWTH_RE = /^\s*-\s+(.+)$/

  function readGrowthEntries() {
    return loadGrowth()
      .split(/\r?\n/)
      .map((row) => row.match(GROWTH_RE))
      .filter((m) => m !== null && m[1].trim() !== '')
      .map((m) => m[1].trim())
  }

  function writeGrowthText(next) {
    const file = growthPath()
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      let previous = ''
      try {
        previous = fs.readFileSync(file, 'utf8')
      } catch {
        previous = ''
      }
      if (previous.trim() !== '') fs.writeFileSync(`${file}.bak`, previous, 'utf8')
      const tmp = `${file}.tmp-${process.pid}`
      fs.writeFileSync(tmp, next, 'utf8')
      fs.renameSync(tmp, file)
      growthCache.mtimeMs = -1
      growthCache.size = -1
      return true
    } catch (error) {
      warn(`写成长记录失败: ${String((error && error.message) || error)}`)
      return false
    }
  }

  function growthAdd(text) {
    // 一条 = 一行：换行会被压成空格，避免有人塞进一段。
    const clean = String(text ?? '').replace(/\r?\n/g, ' ').trim()
    if (clean === '') return false
    let current = ''
    try {
      current = fs.readFileSync(growthPath(), 'utf8')
    } catch {
      current = ''
    }
    const base = current.trim() === '' ? '# 关于使用者（相处中学到的）' : current.replace(/\s*$/, '')
    const next = `${base}\n- ${clean}\n`
    if (next.length > MAX_GROWTH_CHARS) {
      warn(`成长记录会超出 ${MAX_GROWTH_CHARS} 字上限，拒绝追加`)
      return false
    }
    return writeGrowthText(next)
  }

  function growthDelete(text) {
    const target = String(text ?? '').trim()
    if (target === '') return false
    let current = ''
    try {
      current = fs.readFileSync(growthPath(), 'utf8')
    } catch {
      return false
    }
    const rows = current.split(/\r?\n/)
    const idx = rows.findIndex((row) => {
      const m = row.match(GROWTH_RE)
      return m !== null && m[1].trim() === target
    })
    if (idx === -1) return false
    rows.splice(idx, 1)
    return writeGrowthText(`${rows.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '')}\n`)
  }

  function readPending() {
    try {
      return fs
        .readFileSync(growthPendingPath(), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter((v) => v !== null && typeof v.text === 'string' && v.text.trim() !== '')
        .map((v) => ({
          // id 由内容算出，提议方不用自己编 id：手写一行 JSON 就能提议。
          id: sha12(String(v.text).trim()),
          text: String(v.text).trim(),
          reason: String(v.reason ?? ''),
          at: String(v.at ?? ''),
        }))
    } catch {
      return []
    }
  }

  function writePending(list) {
    const file = growthPendingPath()
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const body = list
        .map((v) => JSON.stringify({ at: v.at, text: v.text, reason: v.reason }))
        .join('\n')
      const tmp = `${file}.tmp-${process.pid}`
      fs.writeFileSync(tmp, body === '' ? '' : `${body}\n`, 'utf8')
      fs.renameSync(tmp, file)
      return true
    } catch (error) {
      warn(`写待确认队列失败: ${String((error && error.message) || error)}`)
      return false
    }
  }

  // ── 外部记忆源（可选适配，默认关闭） ────────────────────────────────────
  // 设计约束：**不写死任何记忆插件的名字或格式**。
  // 这里只做两件事：① 找候选目录（要使用者点了才连接）；② 连上之后用来查重。
  // 没装记忆插件的用户，这些接口一律返回空，界面显示「未连接」，不报错、不空转。
  const MD_RE = /\.(md|markdown|txt)$/i
  const SCAN_MAX_FILES = 300
  const SCAN_MAX_BYTES = 2 * 1024 * 1024

  function readMemorySources() {
    try {
      const parsed = JSON.parse(fs.readFileSync(memorySourcesPath(), 'utf8'))
      const list = Array.isArray(parsed?.sources) ? parsed.sources : []
      return list
        .filter((s) => s && typeof s.path === 'string' && s.path.trim() !== '')
        .map((s) => ({ path: String(s.path), label: String(s.label ?? ''), kind: String(s.kind ?? 'markdown') }))
    } catch {
      return []
    }
  }

  function writeMemorySources(list) {
    try {
      fs.mkdirSync(personaDir(), { recursive: true })
      fs.writeFileSync(memorySourcesPath(), `${JSON.stringify({ sources: list }, null, 2)}\n`, 'utf8')
      return true
    } catch (error) {
      warn(`写外部记忆配置失败: ${String((error && error.message) || error)}`)
      return false
    }
  }

  /** 列出目录里的 markdown 文件（深度 ≤2），带文件数与总字节上限，防病态目录。 */
  function listMarkdown(root) {
    const out = []
    let total = 0
    const walk = (dir, depth) => {
      if (depth > 2 || out.length >= SCAN_MAX_FILES) return
      let entries = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (out.length >= SCAN_MAX_FILES) return
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
          walk(full, depth + 1)
          continue
        }
        if (!MD_RE.test(entry.name)) continue
        try {
          const st = fs.statSync(full)
          if (st.size > 512 * 1024) continue
          if (total + st.size > SCAN_MAX_BYTES) return
          total += st.size
          out.push(full)
        } catch {
          // 读不到就跳过
        }
      }
    }
    walk(root, 0)
    return out
  }

  /** 只探几个常见位置；**只返回候选，绝不自动连接**。 */
  function probeMemorySources() {
    const home = dshHome()
    const candidates = [
      { path: path.join(home, 'memory'), label: 'DSH 记忆目录' },
      { path: path.join(home, 'memories'), label: 'DSH memories' },
    ]
    const connected = new Set(readMemorySources().map((s) => s.path.toLowerCase()))
    const found = []
    for (const c of candidates) {
      let isDir = false
      try {
        isDir = fs.statSync(c.path).isDirectory()
      } catch {
        isDir = false
      }
      if (!isDir) continue
      const files = listMarkdown(c.path)
      if (files.length === 0) continue
      found.push({
        path: c.path,
        label: c.label,
        files: files.length,
        connected: connected.has(c.path.toLowerCase()),
      })
    }
    return found
  }

  /** 抽 token：CJK 用二元组，拉丁用词。只服务于粗查重。 */
  function tokensOf(text) {
    const s = String(text ?? '')
    const latin = s.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? []
    const cjk = s.match(/[\u4e00-\u9fa5]{2,}/g) ?? []
    const bigrams = []
    for (const run of cjk) {
      for (let i = 0; i < run.length - 1; i += 1) bigrams.push(run.slice(i, i + 2))
    }
    return Array.from(new Set([...latin, ...bigrams])).slice(0, 24)
  }

  /**
   * 粗查重：新增成长记录前，看看已连接的外部记忆里有没有很像的。
   * 判据刻意朴素（一行命中 ≥3 个 token）——这是**提醒**，不是拦截。
   */
  function checkSimilar(text) {
    const tokens = tokensOf(text)
    if (tokens.length === 0) return []
    const hits = []
    for (const src of readMemorySources()) {
      for (const file of listMarkdown(src.path)) {
        let body = ''
        try {
          body = fs.readFileSync(file, 'utf8')
        } catch {
          continue
        }
        const rows = body.split(/\r?\n/)
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i].trim()
          if (row.length < 8) continue
          let hit = 0
          for (const t of tokens) if (row.includes(t)) hit += 1
          if (hit >= 3) {
            hits.push({ source: src.path, file, line: i + 1, text: row.slice(0, 160), score: hit })
            if (hits.length >= 8) return hits
          }
        }
      }
    }
    return hits
  }

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
      // 成长段：跟着人设走，但不属于人设。空文件时返回空串，等于不注入。
      ctx.effect(
        () =>
          systemPrompt.section({
            name: GROWTH_SECTION,
            order: GROWTH_ORDER,
            text: () => loadGrowth(),
          }),
        'peach-persona: prompt section (growth)',
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
                  const lk = readLock()
                  const gr = loadGrowth()
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
                    // 锁定：设计完成后设置页折叠成一张卡。
                    locked: lk.locked,
                    lockedAt: lk.lockedAt,
                    // 成长段：人格设计之后学到的，跟着人设一起注入。
                    // entries 是解析出来的一条条；pending 是**还没采纳**的提议（不注入）。
                    growth: {
                      text: gr,
                      chars: gr.length,
                      max: MAX_GROWTH_CHARS,
                      file: growthPath(),
                      entries: readGrowthEntries(),
                      pending: readPending(),
                      pendingFile: growthPendingPath(),
                    },
                    // 外部记忆：只报「已连接」的源，没连就是空数组，界面据此显示「未连接」。
                    memory: { sources: readMemorySources() },
                  })
                  return
                }

                // 锁定 / 解锁：只改设置页的形态，不动人设与注入。
                if (route === '/lock' && req.method === 'POST') {
                  const ok = writeLock({ locked: true, lockedAt: new Date().toISOString() })
                  const lk2 = readLock()
                  send(ok ? 200 : 500, { ok, ...lk2 })
                  return
                }

                if (route === '/unlock' && req.method === 'POST') {
                  const ok = writeLock({ locked: false, lockedAt: '' })
                  const lk2 = readLock()
                  send(ok ? 200 : 500, { ok, ...lk2 })
                  return
                }

                // ── 成长记录：可增可删（B）+ 提议待确认（C） ──────────────
                if (route.startsWith('/growth/') && req.method === 'POST') {
                  const action = route.slice('/growth/'.length)
                  const body = await readBody(req)
                  const parsed = JSON.parse(body || '{}')

                  // 查重必须是这个分支里的一个动作：否则会被下面的通用分支先截走。
                  if (action === 'check') {
                    send(200, { ok: true, similar: checkSimilar(parsed.text), memory: readMemorySources() })
                    return
                  }

                  if (action === 'add') {
                    const okAdd = growthAdd(parsed.text)
                    send(okAdd ? 200 : 400, {
                      ok: okAdd,
                      entries: readGrowthEntries(),
                      error: okAdd ? undefined : `空内容或超出 ${MAX_GROWTH_CHARS} 字上限`,
                    })
                    return
                  }

                  if (action === 'delete') {
                    const okDel = growthDelete(parsed.text)
                    send(okDel ? 200 : 404, {
                      ok: okDel,
                      entries: readGrowthEntries(),
                      error: okDel ? undefined : '没有这条记录',
                    })
                    return
                  }

                  if (action === 'approve' || action === 'reject') {
                    const wanted = String(parsed.id ?? '')
                    const list = readPending()
                    const idx = list.findIndex((v) => v.id === wanted)
                    if (idx === -1) {
                      send(404, { ok: false, error: '待确认项不存在（可能已处理）' })
                      return
                    }
                    const item = list[idx]
                    if (action === 'approve' && !growthAdd(item.text)) {
                      send(400, { ok: false, error: '采纳失败：内容为空或超出上限' })
                      return
                    }
                    list.splice(idx, 1)
                    writePending(list)
                    send(200, {
                      ok: true,
                      approved: action === 'approve' ? item.text : undefined,
                      entries: readGrowthEntries(),
                      pending: readPending(),
                    })
                    return
                  }

                  send(404, { ok: false, error: `未知操作 ${action}` })
                  return
                }

                // ── 外部记忆：探测 / 连接 / 断开 / 查重（全部可选，默认关闭） ──
                if (route === '/memory' && req.method === 'GET') {
                  send(200, { ok: true, sources: readMemorySources() })
                  return
                }

                if (route === '/memory/probe' && req.method === 'POST') {
                  send(200, { ok: true, candidates: probeMemorySources() })
                  return
                }

                if (route === '/memory/connect' && req.method === 'POST') {
                  const body = await readBody(req)
                  const parsed = JSON.parse(body || '{}')
                  const target = String(parsed.path ?? '').trim()
                  let isDir = false
                  try {
                    isDir = target !== '' && fs.statSync(target).isDirectory()
                  } catch {
                    isDir = false
                  }
                  if (!isDir) {
                    send(400, { ok: false, error: '路径不存在或不是目录' })
                    return
                  }
                  const list = readMemorySources().filter((s) => s.path.toLowerCase() !== target.toLowerCase())
                  list.push({ path: target, label: String(parsed.label ?? ''), kind: 'markdown' })
                  writeMemorySources(list)
                  send(200, { ok: true, sources: readMemorySources() })
                  return
                }

                if (route === '/memory/disconnect' && req.method === 'POST') {
                  const body = await readBody(req)
                  const parsed = JSON.parse(body || '{}')
                  const target = String(parsed.path ?? '').trim().toLowerCase()
                  const list = readMemorySources().filter((s) => s.path.toLowerCase() !== target)
                  writeMemorySources(list)
                  send(200, { ok: true, sources: readMemorySources() })
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
