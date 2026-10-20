// 渲染器契约测试：字段 → 人设文本。
//
// 不碰文件系统，也不需要运行中的宿主。这里钉死的是几个容易回退的行为：
// 空就是空、名字与自称是两件事、空字段整行省略。
import { reporter, moduleUrl } from './_helpers.mjs'

const { say, finish } = reporter('render')

const { DEFAULTS, FIELD_KEYS, renderPersona } = await import(moduleUrl('lib/fields.js'))

// ── 字段表 ─────────────────────────────────────────────────────────────────
say(FIELD_KEYS.length === 12, 'twelve fields', String(FIELD_KEYS.length))
say(Object.values(DEFAULTS).every((v) => v === ''), 'every default is empty')
say(DEFAULTS.selfRef === '', 'self-reference defaults to empty (author value is not shipped)')

// ── 空 ─────────────────────────────────────────────────────────────────────
say(renderPersona({}) === '', 'no fields → empty string (nothing injected)')
say(renderPersona(DEFAULTS) === '', 'all-empty defaults → empty string')

// ── 只有名字 ───────────────────────────────────────────────────────────────
const named = renderPersona({ agentName: '甲' })
say(named.startsWith('你是甲，由 {{model}} 驱动。'), 'identity line keeps the {{model}} variable')
say(!named.includes('称呼：'), 'no greeting line without a user title')
say(!named.includes('自称：'), 'no self-reference line without one')

// ── 名字 ≠ 自称 ────────────────────────────────────────────────────────────
const full = renderPersona({ agentName: '甲', nickname: '小甲', userTitle: '老板', selfRef: '本人' })
say(full.includes('称呼：称用户为「老板」，他叫你「甲」，简称「小甲」也行。'), 'greeting line combines title, name and nickname')
say(full.includes('自称：跟你说话时用它指代自己——本人。'), 'self-reference is its own line')
say(!full.includes('指代自己——甲'), 'the NAME is never reused as the self-reference')

// ── 没有名字但自称有值 ─────────────────────────────────────────────────────
const noName = renderPersona({ userTitle: '老板', selfRef: '本人' })
say(!noName.includes('你是'), 'no dangling identity line when the name is empty')
say(noName.includes('自称：'), 'self-reference still renders without a name')

// ── 分段 ───────────────────────────────────────────────────────────────────
const withRules = renderPersona({ agentName: '甲', rulesHeading: '约定：', rules: '1. 说短话' })
say(withRules.includes('\n\n---\n\n'), 'head and tail are separated by a "---" line')
say(withRules.trimEnd().endsWith('1. 说短话'), 'tail keeps the rules text')

const tailOnly = renderPersona({ rulesHeading: '约定：', rules: '1. 说短话' })
say(tailOnly.startsWith('---'), 'tail-only persona still keeps the separator (split rule always holds)')

// ── 空字段整行省略 ─────────────────────────────────────────────────────────
const sparse = renderPersona({ agentName: '甲', tone: '', verbosity: '', avoid: '', language: '' })
say(!sparse.includes('说话基调'), 'empty tone line omitted')
say(!sparse.includes('篇幅'), 'empty verbosity line omitted')
say(!sparse.includes('禁忌'), 'empty avoid line omitted')

finish()
