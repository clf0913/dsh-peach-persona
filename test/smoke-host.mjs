// 宿主半侧冒烟：用假的 ctx 驱动真实模块，全流程不碰使用者的真实 ~/.dsh。
//
// 覆盖：依赖声明、两段提示词注册、HTTP 路由、全新安装（空表单 + 不写任何文件）、
// 预览不落盘、保存落盘并重渲染、未知路由。
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { reporter, moduleUrl, useScratchHome } from './_helpers.mjs'

const { say, finish } = reporter('smoke-host')

// 必须在 import 插件之前设置 DSH_HOME：插件在模块层读它。
const scratch = useScratchHome()
const mdPath = join(scratch.personaDir, 'persona.md')
const jsonPath = join(scratch.personaDir, 'persona.json')

const mod = await import(moduleUrl('lib/index.js'))

say(
  Array.isArray(mod.inject) && mod.inject.includes('systemPrompt') && mod.inject.includes('webServer'),
  'declares inject for both services (waits instead of skipping)',
  JSON.stringify(mod.inject),
)

// ── 驱动 apply ─────────────────────────────────────────────────────────────
const sections = []
const routes = []
const ctx = {
  get: (key) =>
    key === 'systemPrompt'
      ? { section: (s) => { sections.push(s); return () => {}; } }
      : key === 'webServer'
        ? { register: (r) => { routes.push(r); return () => {}; } }
        : undefined,
  effect: (fn) => fn(),
}

let threw = ''
try {
  mod.apply(ctx)
} catch (error) {
  threw = String((error && error.message) || error)
}
say(threw === '', 'apply() does not throw', threw)

say(sections.length === 2, 'registers two prompt sections', sections.map((s) => `${s.name}@${s.order}`).join(', '))
const head = sections.find((s) => s.name === 'peach:persona')
const tail = sections.find((s) => s.name === 'peach:persona-tail')
say(head?.order === 1, 'head section order 1')
say(tail?.order === 10201, 'tail section order 10201')

const route = routes.find((r) => r.path === '/api/peach-persona')
say(Boolean(route) && route.kind === 'prefix', 'registers prefix route /api/peach-persona')

const call = async (method, path, body) => {
  const req = new EventEmitter()
  req.method = method
  req.url = `/api/peach-persona${path}`
  req.headers = {}
  let status = 0
  let text = ''
  const res = {
    writeHead: (code) => { status = code },
    end: (bytes) => { text = Buffer.from(bytes).toString('utf8') },
  }
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body), 'utf8'))
    req.emit('end')
  })
  await route.handler(req, res)
  let json = null
  try { json = JSON.parse(text) } catch { json = null }
  return { status, json, text }
}

// ── 全新安装：空白，且不写任何文件 ─────────────────────────────────────────
const fresh = await call('GET', '/state')
say(fresh.status === 200 && fresh.json?.ok === true, 'GET /state ok on a clean home')
const freshFields = fresh.json?.fields ?? {}
say(Object.keys(freshFields).length === 12, '12 fields on a clean home', String(Object.keys(freshFields).length))
say(Object.values(freshFields).every((v) => v === ''), 'every field empty on a clean home')
say(!existsSync(mdPath), 'no persona.md written before the user saves')
say(!existsSync(jsonPath), 'no persona.json written before the user saves')
say(head.text() === '', 'injected head is empty on a clean home')
say(tail.text() === '', 'injected tail is empty on a clean home')

// ── 预览不落盘 ─────────────────────────────────────────────────────────────
await call('POST', '/save', { fields: { agentName: '甲', userTitle: '老板' } })
const baseline = await call('GET', '/state')
say(baseline.json.fields.agentName === '甲', 'baseline save persisted')

const draft = {
  agentName: '乙',
  nickname: '小乙',
  userTitle: '老板',
  selfRef: '本人',
  relationship: '测试搭子',
  language: '中文',
  tone: '简短。',
  verbosity: '两行以内。',
  disagreement: '直说。',
  avoid: '不要编资料。',
  rulesHeading: '约定：',
  rules: '1. 先给结论。',
}
const preview = await call('POST', '/preview', { fields: draft })
say(preview.status === 200 && preview.json?.ok === true, 'POST /preview ok')
say(preview.json.text.includes('你是乙'), 'preview reflects the NEW name')
say(!preview.json.text.includes('你是甲'), 'preview does not leak the saved name')
say(preview.json.text.includes('自称：跟你说话时用它指代自己——本人。'), 'preview renders the self-reference')
const afterPreview = await call('GET', '/state')
say(afterPreview.json.fields.agentName === '甲', 'preview did NOT persist')

// ── 保存落盘并重渲染 ───────────────────────────────────────────────────────
const saved = await call('POST', '/save', { fields: draft })
say(saved.status === 200 && saved.json?.ok === true, 'POST /save ok', saved.json && `${saved.json.chars} chars`)
say(existsSync(jsonPath) && existsSync(mdPath), 'field table and markdown written')
const md = readFileSync(mdPath, 'utf8')
say(md.includes('你是乙') && md.includes('自称：'), 'markdown regenerated from fields')
say(md.includes('\n---\n'), 'markdown keeps the head/tail separator')
say(JSON.parse(readFileSync(jsonPath, 'utf8')).selfRef === '本人', 'self-reference persisted')
say(head.text().includes('乙'), 'injected head follows the saved fields')
say(tail.text().includes('约定：'), 'injected tail follows the saved fields')

// ── 错误处理 ───────────────────────────────────────────────────────────────
const nope = await call('GET', '/nope')
say(nope.status === 404 && nope.json?.ok === false, 'unknown route returns a JSON 404', String(nope.status))

const log = readFileSync(join(scratch.personaDir, 'inject.jsonl'), 'utf8')
say(log.includes('"kind":"save"'), 'save is recorded in the injection log')

scratch.cleanup()
finish()
