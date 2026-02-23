# One-URL Doc Q&A

An AI-powered Q&A app that loads **one** documentation URL, chunks it in memory, and answers questions using only that page. Built for Cloudflare (Workers, Durable Objects, Workers AI). No Vectorize—retrieval is keyword-based.

## Features

- **Set URL**: Paste a doc URL → Worker fetches the page, strips HTML, chunks by section/size, stores chunks in a Durable Object for your session.
- **Ask**: Type a question → keyword retrieval over chunks, then Llama 3.3 (Workers AI) answers with context; response streams to the UI.
- **State**: One Durable Object per session holds `url`, `chunks`, and `messages` (conversation history).

## Requirements

- Node.js 18+
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI
- Cloudflare account with Workers AI and Durable Objects enabled

## Setup

```bash
npm install
```

## Develop

```bash
npm run dev
```

Open the URL Wrangler prints (e.g. `http://localhost:8787`). Enter a documentation URL, click **Load doc**, then ask questions in the chat.

## Deploy

```bash
npm run deploy
```

## Project layout

- `src/index.ts` – Worker: session cookie, forwards `/api/*` to the Durable Object, serves static from `public/`.
- `src/DocSession.ts` – Durable Object: `/set-url` (fetch, strip HTML, chunk, persist), `/ask` (keyword retrieval + Llama 3.3 stream), `/status` (url/chunks/messages count).
- `public/index.html`, `public/app.js` – Frontend: URL input, chat UI, streamed answers (SSE parsing).

## API

- `POST /api/set-url` – Body: `{ "url": "https://..." }`. Loads and chunks the page for this session.
- `POST /api/ask` – Body: `{ "message": "..." }`. Returns a streamed SSE response (Workers AI format).
- `GET /api/status` – Returns `{ url, chunks, messages }` for the current session.

## License

MIT
