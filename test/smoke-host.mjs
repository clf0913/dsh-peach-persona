// 宿主半侧冒烟：用假的 ctx 驱动真实模块，全流程不碰使用者的真实 ~/.dsh。
//
// 覆盖：依赖声明、两段提示词注册、HTTP 路由、全新安装（空表单 + 不写任何文件）、
// 预览不落盘、保存落盘并重渲染、未知路由。
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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

say(sections.length === 3, 'registers three prompt sections', sections.map((s) => `${s.name}@${s.order}`).join(', '))
const head = sections.find((s) => s.name === 'peach:persona')
const tail = sections.find((s) => s.name === 'peach:persona-tail')
const growth = sections.find((s) => s.name === 'peach:growth')
say(head?.order === 1, 'head section order 1')
say(tail?.order === 10201, 'tail section order 10201')
say(growth?.order === 3, 'growth section order 3')

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

// ── 锁定 / 解锁（只影响设置页形态，不动人设与注入） ─────────────────────
const beforeLock = await call('GET', '/state')
say(beforeLock.json?.locked === false, 'state reports unlocked on a clean home')
const lockedRes = await call('POST', '/lock')
say(lockedRes.status === 200 && lockedRes.json?.ok === true && lockedRes.json.locked === true, 'POST /lock ok')
const afterLock = await call('GET', '/state')
say(afterLock.json?.locked === true, 'state reports locked after /lock')
say(typeof afterLock.json?.lockedAt === 'string' && afterLock.json.lockedAt !== '', 'lock records a timestamp')
say(Boolean(afterLock.json?.growth) && typeof afterLock.json.growth.text === 'string', 'state carries the growth section')
say(head.text().includes('乙'), 'locking does not change the injected persona')
const unlockedRes = await call('POST', '/unlock')
say(unlockedRes.status === 200 && unlockedRes.json?.ok === true && unlockedRes.json.locked === false, 'POST /unlock ok')
const afterUnlock = await call('GET', '/state')
say(afterUnlock.json?.locked === false, 'state reports unlocked again')

// ── 错误处理 ───────────────────────────────────────────────────────────────
const nope = await call('GET', '/nope')
say(nope.status === 404 && nope.json?.ok === false, 'unknown route returns a JSON 404', String(nope.status))

const log = readFileSync(join(scratch.personaDir, 'inject.jsonl'), 'utf8')
say(log.includes('"kind":"save"'), 'save is recorded in the injection log')

// ── 成长记录：B（可增可删）+ C（提议待确认，采纳前不注入） ─────────────────
const growthFile = join(scratch.personaDir, 'growth.md')
const pendingFile = join(scratch.personaDir, 'growth-pending.jsonl')
const growthSection = sections.find((s) => s.name === 'peach:growth')
say(Boolean(growthSection), 'registers the growth section', growthSection && `order ${growthSection.order}`)
say(growthSection.text() === '', 'growth section empty on a clean home')

const g1 = await call('POST', '/growth/add', { text: '他问「有意义吗」时是在问值不值得做' })
say(g1.status === 200 && g1.json?.ok === true, 'growth/add ok')
say(g1.json.entries.length === 1, 'one entry after add')
say(growthSection.text().includes('值不值得做'), 'new entry is injected')

const g2 = await call('POST', '/growth/add', { text: '第二条测试记录' })
say(g2.json.entries.length === 2, 'two entries after the second add')

const g3 = await call('POST', '/growth/delete', { text: '第二条测试记录' })
say(g3.status === 200 && g3.json.entries.length === 1, 'delete removes the entry')
say(!growthSection.text().includes('第二条测试记录'), 'deleted entry no longer injected')

// 提议：写进 pending 文件，采纳之前**绝不能**出现在注入内容里
mkdirSync(scratch.personaDir, { recursive: true })
writeFileSync(
  pendingFile,
  `${JSON.stringify({ at: '2026-11-01T00:00:00Z', text: '这是一条还没被采纳的提议', reason: '测试用' })}\n`,
  'utf8',
)
const st2 = await call('GET', '/state')
say(st2.json.growth.pending.length === 1, 'pending proposal is listed')
say(!growthSection.text().includes('还没被采纳的提议'), 'pending proposal is NOT injected before approval')

const badId = await call('POST', '/growth/approve', { id: 'nope' })
say(badId.status === 404, 'approving an unknown id returns 404', String(badId.status))

const appr = await call('POST', '/growth/approve', { id: st2.json.growth.pending[0].id })
say(appr.status === 200 && appr.json.pending.length === 0, 'approve clears the pending item')
say(growthSection.text().includes('还没被采纳的提议'), 'approved proposal becomes injected')
say(
  readFileSync(growthFile, 'utf8').includes('- 这是一条还没被采纳的提议'),
  'approved proposal is a bullet in growth.md',
)

const tooLong = await call('POST', '/growth/add', { text: 'x'.repeat(5000) })
say(tooLong.status === 400 && tooLong.json?.ok === false, 'over-limit add is rejected', String(tooLong.status))

// ── 外部记忆（可选适配）：默认不连接、探测只找候选、查重不拦截 ─────────────
const memDir = join(scratch.dir, 'memory')
const probeEmpty = await call('POST', '/memory/probe', {})
say(probeEmpty.status === 200 && probeEmpty.json.candidates.length === 0, 'probe finds nothing on a clean home')

mkdirSync(join(memDir, '工作区'), { recursive: true })
writeFileSync(
  join(memDir, '工作区', 'CS0905.md'),
  '# 项目记忆\n\n- 他问「有意义吗」时是在问值不值得做，不是问能不能做\n',
  'utf8',
)
const probeOne = await call('POST', '/memory/probe', {})
say(probeOne.json.candidates.length === 1, 'probe finds the candidate directory')
say(probeOne.json.candidates[0].files >= 1, 'candidate reports its markdown count')
say(probeOne.json.candidates[0].connected === false, 'probe does NOT auto-connect')

const conn = await call('POST', '/memory/connect', { path: memDir, label: '测试记忆' })
say(conn.status === 200 && conn.json.sources.length === 1, 'connect stores the source')

const check = await call('POST', '/growth/check', { text: '他问「有意义吗」时是在问值不值得做' })
say(check.status === 200 && check.json.similar.length > 0, 'check finds a similar line in the connected source')
say(String(check.json.similar[0].file).includes('CS0905.md'), 'the hit points at the right file')

const checkFar = await call('POST', '/growth/check', { text: '完全无关的一句话：今天天气不错' })
say(checkFar.json.similar.length === 0, 'unrelated text produces no hits')

const stMem = await call('GET', '/state')
say(stMem.json.memory.sources.length === 1, '/state reports the connected source')

const disc = await call('POST', '/memory/disconnect', { path: memDir })
say(disc.status === 200 && disc.json.sources.length === 0, 'disconnect removes the source')

scratch.cleanup()
finish()
