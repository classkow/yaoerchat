/**
 * 注册 Service Worker，让应用可被浏览器安装并在弱网/离线时启动缓存壳。
 *
 * 只在生产环境注册的原因：开发服务器的模块是热更新加载的，Service Worker 缓存住旧资源后
 * 会让调试看到过期代码，清理缓存的排查成本远高于收益；同时开发环境也不需要安装能力。
 *
 * 使用相对路径 './sw.js' 的原因：站点部署在 /yaoerchat/ 子路径下，绝对路径 '/sw.js' 会打到
 * 域名根目录导致 404；相对路径解析出的作用域恰好是 /yaoerchat/，与子路径部署保持一致。
 */
export const registerServiceWorker = (): void => {
  if (process.env.NODE_ENV !== 'production') {
    return
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }
  // Service Worker 只在 https 或 localhost 下可用，file:// 打开时直接跳过
  const { protocol, hostname } = window.location
  if (protocol !== 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return
  }
  window.addEventListener('load', () => {
    // 注册失败不应影响应用启动，静默忽略
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
