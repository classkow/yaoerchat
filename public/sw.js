/**
 * yaoer Service Worker：手写实现，不依赖 Workbox。
 *
 * 职责边界：只保证「应用外壳」离线可启动 + 发版能可靠更新。
 * 不做后台同步、不做推送、不拦截业务 API，所有路径都是相对路径，兼容 /yaoerchat/ 子路径部署。
 *
 * 更新流程刻意做得保守，因为本项目的入口 JS 依赖大量异步 chunk：
 * - install 阶段不调用 skipWaiting，新版本先停在 waiting，由用户在界面上点「刷新」再切换；
 * - activate 阶段不调用 clients.claim，避免正在运行的旧页面被新 Service Worker 突然接管，
 *   页面中途换 SW 会拿到不匹配的 chunk 而白屏；
 * - 导航响应只读缓存不写缓存，写回会让旧 Service Worker 拿到新 HTML 却配旧资源，同样白屏。
 *
 * 本文件是模板：版本号、阻断集、容错集三个占位符由 scripts/gen-precache.mjs 在构建后替换，
 * 产物写到 dist/sw.js。模板里少任何一个占位符，构建都会直接失败。
 */

/** 缓存版本号，由构建脚本按产物内容计算，发布新版本时自动变化 */
const CACHE_VERSION = /*__CACHE_VERSION__*/ 'dev'

/** 应用外壳缓存名，必须包含版本号 */
const CACHE_NAME = `yaoer-shell-${CACHE_VERSION}`

/** 阻断集：入口 HTML / JS / CSS、manifest、图标，任一缺失都会让 install 失败 */
const PRECACHE_REQUIRED = /*__PRECACHE_REQUIRED__*/ []

/** 容错集：异步 chunk 与 woff2 字体，缺失不影响首屏启动 */
const PRECACHE_OPTIONAL = /*__PRECACHE_OPTIONAL__*/ []

/** Service Worker 作用域前缀，用于把绝对路径换算成相对站点根的路径 */
const SCOPE_PATH = new URL('./', self.location.href).pathname

/** 允许写入缓存的路径白名单：静态资源与图标，其余路径一律直接走网络 */
const CACHEABLE_PREFIXES = ['static/', 'icons/']

/** 把绝对路径换算成相对站点根的路径，例如 /yaoerchat/static/js/main.js → static/js/main.js */
const toRelativePath = (pathname) =>
  pathname.startsWith(SCOPE_PATH) ? pathname.slice(SCOPE_PATH.length) : pathname

/** 判断请求是否落在缓存白名单内 */
const isCacheable = (url) => {
  const relative = toRelativePath(url.pathname)
  if (relative === 'manifest.webmanifest') {
    return true
  }
  return CACHEABLE_PREFIXES.some((prefix) => relative.startsWith(prefix))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // 阻断集必须全部成功：任一失败都会让 install 失败，新版本不会激活，用户继续用旧版本
      cache.addAll(PRECACHE_REQUIRED).then(() =>
        // 容错集失败可忽略：异步 chunk / 字体缺失不影响首屏启动
        Promise.all(PRECACHE_OPTIONAL.map((url) => cache.add(url).catch(() => undefined)))
      )
    )
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          // 只清理本应用的旧壳缓存，绝不碰同源下其它应用的 Cache Storage
          .filter((key) => key.startsWith('yaoer-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  )
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (data && data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // 非 GET 请求（尤其是 SSE 流式响应）绝不拦截，直接放行给浏览器
  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  // 跨域请求不由本 Service Worker 负责，避免干扰外部 API
  if (url.origin !== self.location.origin) {
    return
  }

  // 导航请求：网络优先，离线时回退到缓存的 index.html
  // 刻意不把导航响应写回缓存：写回会让旧 Service Worker 拿到新 HTML 却配旧资源，稳定复现白屏
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.open(CACHE_NAME).then((cache) => cache.match('./index.html', { ignoreVary: true }))
      )
    )
    return
  }

  // 只缓存白名单路径；带 Authorization 的请求一律不碰，避免把鉴权响应写进 Cache Storage
  if (!isCacheable(url) || request.headers.has('authorization')) {
    return
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, { ignoreVary: true })
      if (cached) {
        // 命中缓存先返回，后台顺带刷新一份，保证下次拿到的是新资源
        event.waitUntil(
          fetch(request)
            .then((response) =>
              response && response.status === 200 ? cache.put(request, response) : undefined
            )
            .catch(() => undefined)
        )
        return cached
      }
      const response = await fetch(request)
      if (response && response.status === 200) {
        event.waitUntil(cache.put(request, response.clone()).catch(() => undefined))
      }
      return response
    })
  )
})
