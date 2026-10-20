// 测试共用的最小工具：断言计数、临时 DSH_HOME、相对本包的路径解析。
//
// 路径全部相对本文件推导，任何机器、任何目录都能跑；不碰使用者的真实
// ~/.dsh（临时目录建在系统 temp 下，跑完删掉）。
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

/** 包根目录（test/ 的上一级）。 */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 把包内相对路径转成 import 用的 file:// URL。 */
export const moduleUrl = (rel) => pathToFileURL(join(ROOT, rel)).href

/** 断言收集器：逐条打印，最后统一给退出码。 */
export function reporter(title) {
  const problems = []
  const say = (ok, label, detail) => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
    if (!ok) problems.push(label)
  }
  const finish = () => {
    console.log(
      problems.length === 0
        ? `\n${title}: PASSED`
        : `\n${title}: ${problems.length} CHECK(S) FAILED — ${problems.join('; ')}`,
    )
    process.exit(problems.length === 0 ? 0 : 1)
  }
  return { say, finish }
}

/**
 * 把 DSH_HOME 指向一个临时目录，必须在 import lib/index.js **之前**调用，
 * 因为插件在模块层读 process.env.DSH_HOME。
 */
export function useScratchHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-persona-test-'))
  process.env.DSH_HOME = dir
  return {
    dir,
    personaDir: join(dir, 'persona'),
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // 清理失败不影响测试结论
      }
    },
  }
}
