/**
 * 构建后生成 dist/sw.js：扫描产物、算出缓存版本号、把预缓存清单内联进 Service Worker 模板。
 *
 * 为什么不放在 rspack 的 CopyRspackPlugin 里：拷贝插件会改写模板文件，
 * 三个占位符一旦被破坏，Service Worker 就会带着空清单上线，表现为「装完离线白屏」。
 * 这里改成构建后独立一步，模板只要少了占位符就直接构建失败，绝不产出坏文件。
 *
 * 只用 Node 标准库，不引入任何依赖。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDir = path.join(rootDir, 'dist')
const templatePath = path.join(rootDir, 'public', 'sw.js')
const outputPath = path.join(distDir, 'sw.js')

/** 永不进入清单的文件：Service Worker 自身与 LICENSE */
const EXCLUDED_NAMES = new Set(['sw.js', 'LICENSE'])

/**
 * 现代浏览器只取 woff2，woff / ttf 是死重量（实测占字体体积 77%），永不进入清单。
 */
const isDeadWeightFont = (name) => name.endsWith('.woff') || name.endsWith('.ttf')

/** 列出目录下的文件（不含子目录） */
const listFiles = (dir) => {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
}

/** 递归列出目录下的全部文件 */
const listFilesRecursive = (dir) => {
  if (!existsSync(dir)) {
    return []
  }
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

/** 把产物路径转成相对站点根、以 ./ 开头的写法，例如 ./static/js/main.abc.js */
const toSitePath = (absolutePath) => {
  const relative = path.relative(distDir, absolutePath).split(path.sep).join('/')
  return `./${relative}`
}

/** 收集符合条件的文件，重复或被排除的文件直接丢弃 */
const collect = (bucket, absolutePaths) => {
  for (const absolutePath of absolutePaths) {
    const name = path.basename(absolutePath)
    if (EXCLUDED_NAMES.has(name) || isDeadWeightFont(name)) {
      continue
    }
    bucket.push(absolutePath)
  }
}

/** 阻断集：入口 HTML / JS / CSS、manifest、图标，任一缺失都装不出可离线启动的壳 */
const required = []
collect(required, [path.join(distDir, 'index.html')].filter((file) => existsSync(file)))
collect(
  required,
  listFiles(path.join(distDir, 'static', 'js')).filter((file) => /^main\..*\.js$/.test(path.basename(file)))
)
collect(
  required,
  listFiles(path.join(distDir, 'static', 'css')).filter((file) =>
    /^main\..*\.css$/.test(path.basename(file))
  )
)
collect(required, [path.join(distDir, 'manifest.webmanifest')].filter((file) => existsSync(file)))
collect(
  required,
  listFilesRecursive(path.join(distDir, 'icons')).filter((file) => file.endsWith('.png'))
)

/** 容错集：异步 chunk 与 woff2 字体，缺失不影响首屏启动 */
const optional = []
collect(
  optional,
  listFiles(path.join(distDir, 'static', 'media')).filter((file) => file.endsWith('.woff2'))
)
collect(optional, listFiles(path.join(distDir, 'static', 'js', 'async')).filter((file) => file.endsWith('.js')))
collect(
  optional,
  listFiles(path.join(distDir, 'static', 'css', 'async')).filter((file) => file.endsWith('.css'))
)

/** 缺少入口文件时必须报错：空壳的 PWA 装了也用不了 */
const requiredNames = required.map((file) => path.basename(file))
if (!existsSync(path.join(distDir, 'index.html'))) {
  throw new Error('dist/index.html 不存在，无法生成预缓存清单')
}
if (!existsSync(path.join(distDir, 'manifest.webmanifest'))) {
  throw new Error('dist/manifest.webmanifest 不存在，无法生成预缓存清单')
}
if (!requiredNames.some((name) => /^main\..*\.js$/.test(name))) {
  throw new Error('dist/static/js/ 下找不到入口 main.*.js，无法生成预缓存清单')
}
if (!requiredNames.some((name) => /^main\..*\.css$/.test(name))) {
  throw new Error('dist/static/css/ 下找不到入口 main.*.css，无法生成预缓存清单')
}

/** 统一排序，保证同样的产物永远得到同样的版本号 */
required.sort()
optional.sort()

/** 版本号 = 阻断集 + 容错集的「相对路径 + 文件字节」的 sha256 前 8 位 */
const hash = createHash('sha256')
for (const file of [...required, ...optional]) {
  hash.update(toSitePath(file))
  hash.update(readFileSync(file))
}
const version = hash.digest('hex').slice(0, 8)

/**
 * 读取模板并替换占位符；少任何一个都直接失败，绝不产出半成品。
 *
 * 除了三个占位符，还会把缓存名里的模板串塌缩成字面量：
 * 产物里直接写着带版本号的缓存名，既方便 grep 核对版本，也省掉运行期的一次拼接。
 */
const template = readFileSync(templatePath, 'utf8')
const replacements = [
  ["/*__CACHE_VERSION__*/ 'dev'", `'${version}'`],
  [
    '/*__PRECACHE_REQUIRED__*/ []',
    JSON.stringify(required.map((file) => toSitePath(file))),
  ],
  [
    '/*__PRECACHE_OPTIONAL__*/ []',
    JSON.stringify(optional.map((file) => toSitePath(file))),
  ],
  ['`yaoer-shell-${CACHE_VERSION}`', `'yaoer-shell-${version}'`],
]
let output = template
for (const [token, value] of replacements) {
  if (!output.includes(token)) {
    throw new Error(`public/sw.js 中缺少待替换片段 ${token}，无法生成 dist/sw.js`)
  }
  output = output.replace(token, () => value)
}

writeFileSync(outputPath, output)

console.log('[gen-precache] 阻断集条目：', required.length)
for (const file of required) {
  console.log(`[gen-precache]   ${toSitePath(file)}`)
}
console.log('[gen-precache] 容错集条目：', optional.length)
console.log('[gen-precache] 版本号：', version)
console.log('[gen-precache] dist/sw.js 字节数：', Buffer.byteLength(output))
