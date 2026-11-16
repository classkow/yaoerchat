/**
 * yaoer 最小版 Service Worker：只缓存应用外壳，保证弱网/离线时能启动。
 * 不做预缓存清单、不做后台同步、不做推送，所有路径均为相对路径，兼容 /yaoerchat/ 子路径部署。
 */

/** 缓存版本号，发布新版本时递增即可整体失效旧缓存 */
const VERSION = 'v1'

/** 应用外壳缓存名，必须包含版本号 */
const CACHE_NAME = `yaoer-shell-${VERSION}`

/** 安装时预缓存的最小外壳 */
const PRECACHE_URLS = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // 非 GET 请求（尤其是 SSE 流式响应）绝不拦截，直接放行给浏览器
  if (request.method !== 'GET') {
    return
  }

  // 跨域请求不由本 Service Worker 负责，避免干扰外部 API
  if (new URL(request.url).origin !== self.location.origin) {
    return
  }

  // 导航请求：网络优先，失败后回退到缓存的页面
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((cached) => cached || caches.match('./index.html'))
      )
    )
    return
  }

  // 其余同源静态资源：缓存优先，同时后台更新缓存
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
