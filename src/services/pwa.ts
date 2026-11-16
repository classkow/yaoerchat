/**
 * 注册 Service Worker，让应用可被浏览器安装，并在弱网/离线时从缓存启动。
 *
 * 只在生产环境注册的原因：开发服务器的模块是热更新加载的，Service Worker 缓存住旧资源后
 * 会让调试看到过期代码，清理缓存的排查成本远高于收益；同时开发环境也不需要安装能力。
 *
 * 使用相对路径 './sw.js' 的原因：站点部署在 /yaoerchat/ 子路径下，绝对路径 '/sw.js' 会打到
 * 域名根目录导致 404；相对路径解析出的作用域恰好是 /yaoerchat/，与子路径部署保持一致。
 */

/** 更新提示条的 DOM id，同一会话内重复插入时用它去重 */
const UPDATE_PROMPT_ID = 'yaoer-sw-update-prompt'

/** 同一会话只提示一次「有新版本可用」 */
let updatePromptShown = false

/** 只有本模块主动触发了切换，controllerchange 后才刷新页面，避免无关事件导致刷新循环 */
let reloadRequested = false

/**
 * 输出注册失败原因。
 *
 * 仓库开启了 no-console 规则，但注册失败需要留痕；沿用 chat/db.ts 的做法，
 * 用一行 disable 注释保留诊断输出，而不是换写法绕开规则。
 */
const reportFailure = (error: unknown): void => {
  // eslint-disable-next-line no-console
  console.warn('[pwa] service worker 注册失败', error)
}

/**
 * 注入「有新版本可用 / 刷新」的提示条。
 *
 * 不改动 React 树，纯 DOM 追加：提示条属于浏览器层的外壳提示，和聊天状态无关，
 * 走 React 会把更新逻辑耦合进业务组件。
 */
const showUpdatePrompt = (registration: ServiceWorkerRegistration): void => {
  if (updatePromptShown || document.getElementById(UPDATE_PROMPT_ID)) {
    return
  }
  updatePromptShown = true

  const banner = document.createElement('div')
  banner.id = UPDATE_PROMPT_ID
  banner.setAttribute('role', 'status')
  // 放在顶部居中，避开底部的输入区；宽度自适应内容，不写死尺寸
  banner.style.cssText = [
    'position:fixed',
    'top:16px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'max-width:calc(100vw - 32px)',
    'padding:10px 16px',
    'border-radius:10px',
    'background:#111827',
    'color:#f9fafb',
    'font-size:14px',
    'line-height:1.4',
    'box-shadow:0 6px 24px rgba(0,0,0,.24)',
  ].join(';')

  const text = document.createElement('span')
  text.textContent = '有新版本可用'

  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '刷新'
  button.style.cssText = [
    'flex:none',
    'padding:4px 12px',
    'border:0',
    'border-radius:6px',
    'background:#f9fafb',
    'color:#111827',
    'font-size:14px',
    'cursor:pointer',
  ].join(';')
  button.addEventListener('click', () => {
    const waiting = registration.waiting
    if (!waiting) {
      window.location.reload()
      return
    }
    // 新 Service Worker 收到消息后才会接管，接管完成时 controllerchange 触发刷新
    reloadRequested = true
    waiting.postMessage({ type: 'SKIP_WAITING' })
  })

  banner.append(text, button)
  document.body.appendChild(banner)
}

/**
 * 监听注册对象的更新状态，并在页面重新可见时主动检查更新。
 *
 * SPA 长期开着时浏览器不会自动检查新版本，切回标签页时补一次 update() 才能收到新版本。
 */
const watchForUpdates = (registration: ServiceWorkerRegistration): void => {
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    if (!installing) {
      return
    }
    installing.addEventListener('statechange', () => {
      if (installing.state !== 'installed') {
        return
      }
      // 首次安装时页面还没有 controller，属于正常安装而不是升级，不用打扰用户
      if (!navigator.serviceWorker.controller) {
        return
      }
      showUpdatePrompt(registration)
    })
  })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadRequested) {
      return
    }
    reloadRequested = false
    window.location.reload()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      return
    }
    void registration.update().catch(() => undefined)
  })
}

/**
 * 注册 Service Worker，并为「有新版本」提供手动刷新的更新提示。
 *
 * 注册失败不会抛错：Service Worker 只是离线能力，缺失不影响应用正常启动。
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
  const start = (): void => {
    navigator.serviceWorker
      // updateViaCache: 'none' 让 sw.js 不被 HTTP 缓存供给，否则更新检查会拿到旧文件
      .register('./sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        watchForUpdates(registration)
      })
      .catch((error: unknown) => {
        reportFailure(error)
      })
  }

  // load 有可能已经触发（从 bfcache 恢复、或脚本执行极慢），此时再监听 load 永远不会回调
  if (document.readyState === 'complete') {
    start()
  } else {
    window.addEventListener('load', start, { once: true })
  }
}
