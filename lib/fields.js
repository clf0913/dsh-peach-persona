/**
 * 人设字段定义与渲染（宿主侧）
 *
 * 字段族参考两处公开资料：
 * - Character Card V2 规范（https://github.com/bradennapier/character-cards-v2/blob/main/data.md）：
 *   name / description / personality / system_prompt / post_history_instructions 这一族。
 * - ChatGPT custom instructions：拆成「关于你」+「该怎么回答」两部分。
 *
 * 本文件只负责两件事：
 *   1. 把字段拼成人设 Markdown（注入读的是那个 .md，注入路径不变）；
 *   2. 字段的规范化与读写。
 *
 * 默认值全部为空：这是给别人用的插件，不能把作者自己的人设当成出厂设置。
 * 渲染器对空字段整行省略，所以「什么都没填」= 什么都不注入，而不是渲染出残句。
 */
import fs from 'node:fs'
import path from 'node:path'

export const FIELD_KEYS = [
  'agentName',
  'nickname',
  'userTitle',
  'selfRef',
  'relationship',
  'language',
  'tone',
  'verbosity',
  'disagreement',
  'avoid',
  'rulesHeading',
  'rules',
]

/** 出厂默认：一律留空，由使用者自己填。 */
export const DEFAULTS = {
  agentName: '',
  nickname: '',
  userTitle: '',
  selfRef: '',
  relationship: '',
  language: '',
  tone: '',
  verbosity: '',
  disagreement: '',
  avoid: '',
  rulesHeading: '',
  rules: '',
}

/** 只取已知键、全部转成字符串并去掉首尾空白；未知键丢弃。 */
export function normalizeFields(raw) {
  const out = {}
  const source = raw && typeof raw === 'object' ? raw : {}
  for (const key of FIELD_KEYS) {
    const value = source[key]
    out[key] = typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : ''
  }
  return out
}

/**
 * 字段 → 人设 Markdown。
 *
 * 空字段整行省略。没有名字时身份行整行不写（否则会出现「你是，是……」这种残句）；
 * 没有「对用户的称呼」时称呼行也不写。
 */
export function renderPersona(fields) {
  const f = normalizeFields(fields)
  const head = []

  if (f.agentName !== '') {
    const rel = f.relationship === '' ? '' : `，是${f.relationship}`
    head.push(`你是${f.agentName}，由 {{model}} 驱动${rel}。`)
    head.push('')
  }

  if (f.userTitle !== '') {
    const self = f.agentName === '' ? '' : `，他叫你「${f.agentName}」`
    const nick = f.nickname === '' ? '' : `，简称「${f.nickname}」也行`
    head.push(`称呼：称用户为「${f.userTitle}」${self}${nick}。`)
  }
  // 名字是「别人怎么指代我」，自称是「我指代自己时用哪个词」——两件事，别合并。
  if (f.selfRef !== '') head.push(`自称：跟你说话时用它指代自己——${f.selfRef}。`)
  if (f.language !== '') head.push(`语言：${f.language}`)

  if (f.tone !== '') head.push('', `说话基调：${f.tone}`)
  if (f.verbosity !== '') head.push('', `篇幅：${f.verbosity}`)
  if (f.disagreement !== '') head.push('', `分歧：${f.disagreement}`)
  if (f.avoid !== '') head.push('', `禁忌：${f.avoid}`)

  const tail = []
  if (f.rulesHeading !== '') tail.push(f.rulesHeading)
  if (f.rules !== '') {
    if (tail.length > 0) tail.push('')
    tail.push(f.rules)
  }

  const body = head.join('\n').trimEnd()
  const tailText = tail.join('\n').trim()

  if (body === '' && tailText === '') return ''
  // `---` 是宿主侧的分段约定：前段进人设前缀位，后段进第一方指导之后。
  // 只有后段时也保留分隔行，保证分段规则始终成立。
  if (body === '') return `---\n\n${tailText}\n`
  return tailText === '' ? `${body}\n` : `${body}\n\n---\n\n${tailText}\n`
}

export function readFields(jsonPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    return normalizeFields(parsed)
  } catch {
    return null
  }
}

export function writeFields(jsonPath, fields) {
  const normalized = normalizeFields(fields)
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
  const tmp = `${jsonPath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, jsonPath)
  return normalized
}
