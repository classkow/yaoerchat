# yaoerchat

A personal chat web app. Runs entirely in the browser — there is no backend,
requests go straight to the DeepSeek API, and the API key stays local.
Installable as a PWA, so it also starts offline.

## Run

Requires Node.js 22.12+ and pnpm:

```sh
pnpm install
pnpm dev      # http://localhost:8090
pnpm build    # output in dist/
```

## License

MIT. Based on [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo).