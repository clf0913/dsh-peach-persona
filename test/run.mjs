// 测试入口：依次跑 test/ 下的每个 .mjs（跳过本文件与 _ 开头的工具文件）。
//
// 用 stdio: 'inherit' 而不是默认的管道：Windows 沙箱环境里命名管道可能被禁，
// 捕获子进程输出会直接失败；继承父进程的 stdio 没有这个问题。
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(HERE)
  .filter((name) => name.endsWith('.mjs') && name !== 'run.mjs' && !name.startsWith('_'))
  .sort()

if (files.length === 0) {
  console.log('no test files found')
  process.exit(1)
}

let failed = 0
for (const file of files) {
  console.log(`\n========== ${file} ==========`)
  const result = spawnSync(process.execPath, [join(HERE, file)], { stdio: 'inherit' })
  if (result.status !== 0) failed += 1
}

console.log(
  failed === 0
    ? `\nALL ${files.length} TEST FILE(S) PASSED`
    : `\n${failed} of ${files.length} TEST FILE(S) FAILED`,
)
process.exit(failed === 0 ? 0 : 1)
