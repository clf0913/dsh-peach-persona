// 发布检查：清单、补丁、本地化、图标，以及「不随包泄漏作者自己的人设」。
//
// 最后一条是这个插件最容易被后续改动悄悄破坏的承诺：多写一个"贴心默认值"，
// 就变成把作者的人设塞给所有装它的人。所以用扫描钉住。
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reporter, moduleUrl, ROOT } from './_helpers.mjs'

// 本文件必须从扫描里排除：它自己就写着禁用词清单。清单是检查用的元数据，
// 不是随包分发的人设内容。
const SELF = fileURLToPath(import.meta.url)

const { say, finish } = reporter('check-release')

// ── 清单 ───────────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
say(typeof pkg.name === 'string' && pkg.name !== '', 'package name', pkg.name)
say(pkg.type === 'module', 'type is module')
say(pkg.private !== true, 'not private (distributable)')
say(pkg.license === 'MIT' && existsSync(join(ROOT, 'LICENSE')), 'MIT license field and LICENSE file')
say(existsSync(join(ROOT, 'README.md')), 'README present')
say(pkg.exports?.['.'] === './lib/index.js', 'exports "."')
say(pkg.exports?.['./client'] === './lib/client.js', 'exports "./client"')
say(Boolean(pkg.exports?.['./locale/*.json']), 'exports locale files')
say(Boolean(pkg.exports?.['./icon']), 'exports icon')
say(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch')
say(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform = web')

let missing = 0
for (const entry of pkg.files ?? []) {
  if (entry.includes('*')) continue
  if (!existsSync(join(ROOT, entry))) {
    console.log(`     missing declared file: ${entry}`)
    missing += 1
  }
}
say(missing === 0, 'every declared file exists')
say((pkg.files ?? []).includes('test'), 'tests ship with the package')
say(!(pkg.files ?? []).includes('default-persona.md'), 'no shipped default persona')

// ── 补丁 ───────────────────────────────────────────────────────────────────
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
say(/^\s*- insert:/m.test(patch), 'patch has "- insert:"')
say(patch.includes(`name: ${pkg.name}`), 'patch row name matches the package name')
say(!patch.includes('\t'), 'patch has no tabs')

// ── 本地化与图标 ───────────────────────────────────────────────────────────
for (const locale of readdirSync(join(ROOT, 'locale'))) {
  const json = JSON.parse(readFileSync(join(ROOT, 'locale', locale), 'utf8'))
  say(Boolean(json.meta?.title && json.meta?.description), `locale ${locale} has meta.title + meta.description`)
  say(!/my-decoration|Draws a badge/i.test(JSON.stringify(json)), `locale ${locale} has no template copy`)
}
const iconPath = join(ROOT, 'icon.svg')
const icon = readFileSync(iconPath, 'utf8')
say(icon.trimStart().startsWith('<svg') && icon.includes('</svg>'), 'icon is svg and closes')
say(statSync(iconPath).size <= 256 * 1024, 'icon within 256 KiB', `${statSync(iconPath).size} bytes`)

// ── 出厂默认必须为空 ───────────────────────────────────────────────────────
const fields = await import(moduleUrl('lib/fields.js'))
const nonEmpty = Object.entries(fields.DEFAULTS).filter(([, v]) => v !== '')
say(nonEmpty.length === 0, 'every field default is empty', nonEmpty.map(([k]) => k).join(', ') || 'none')
say(fields.FIELD_KEYS.length === 12, 'twelve fields', String(fields.FIELD_KEYS.length))
say(fields.renderPersona({}) === '', 'empty fields render an empty persona')

// ── 不携带作者私有内容 ─────────────────────────────────────────────────────
// 想加自己的默认值时，请改这里之前先想清楚：那会一起发给所有使用者。
const PERSONAL = ['大肥鱼桃子', '老大', '本鲸']
const offenders = []
;(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      walk(full)
      continue
    }
    if (!/\.(js|mjs|json|md|yml|svg|txt)$/.test(entry.name)) continue
    if (full === SELF) continue
    const text = readFileSync(full, 'utf8')
    for (const needle of PERSONAL) {
      if (text.includes(needle)) offenders.push(`${relative(ROOT, full)} contains "${needle}"`)
    }
  }
})(ROOT)
say(offenders.length === 0, 'no author persona strings shipped', offenders.join('; ') || 'clean')

finish()
