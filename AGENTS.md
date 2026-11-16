# yaoerchat

项目说明、运行命令与数据结构见 `README.md`。本文只写改动时的边界。

## 三条会直接造成线上故障的约定

1. **站内路径一律相对**（`./xxx`）。站点部署在子路径 `/yaoerchat/` 下，写 `/xxx` 会打到域名根导致 404。
   唯一例外是 manifest 的 `id`：它按 `start_url` 的 origin 解析，必须写 `"/yaoerchat/"`。

2. **`public/sw.js` 是模板，不是产物**。版本号与预缓存清单由 `scripts/gen-precache.mjs` 在构建后替换；
   直接改它不影响线上，改 `dist/sw.js` 也会被下次构建覆盖。
   Service Worker 刻意不做自动接管（不调用 `skipWaiting` / `clients.claim`），新版需用户点「刷新」才切换——
   这样开着旧标签页时，按需加载的 chunk 不会被清掉。

3. **`public/icons/*.png` 是生成好的位图**，尺寸与安全区已对齐。换图标请整组重新生成，不要单独改一张：

   ```sh
   python3 scripts/gen-pwa-icons.py --out public/icons --letter <字母>   # 需要 Pillow
   ```

   脚本末尾会打印客观校验（尺寸、四角透明度、maskable 安全区），全部通过才算生成成功。

## 改代码时

- 不新增依赖。能用标准 API 或几十行手写实现，就不要引入库。
- 不放宽检查：不调整 `tsconfig.json`、`.oxlintrc.json`，也不加 `eslint-disable` 掩盖问题。
  个别诊断输出有先例，写法见 `src/services/chat/db.ts`。
- 代码风格由 `oxfmt` 与 `oxlint` 决定，改完跑 `pnpm format`。
- 界面文案在 `src/i18n/`，中英两边都要改。
- `dist/` 是构建产物，不手改、不提交。

## 改完必须能过

`pnpm type`、`pnpm lint`、`pnpm build`——CI 就是这三条，任一失败不发布。