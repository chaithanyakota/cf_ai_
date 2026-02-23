# DocChat (cf_ai_)

An AI-powered doc chat app that loads **one** documentation URL, chunks it in memory, and answers questions using that page as context. Built on Cloudflare Workers, Durable Objects, and Workers AI (Llama 3.3).

## Demo

<https://github.com/user-attachments/assets/3a3d71b6-d662-4f4a-832e-3b97830a355b>

## Features

- **Set URL**: Paste a doc URL → Worker fetches the page, strips HTML, chunks by section/size, stores chunks in a Durable Object for your session.
- **Ask**: Type a question → keyword retrieval over chunks, then Llama 3.3 (Workers AI) answers with context; response streams to the UI.
- **State**: One Durable Object per session holds `url`, `chunks`, and `messages` (conversation history).

## Running instructions

**Try locally**

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
3. Open the URL Wrangler prints (e.g. <http://localhost:8787>) in your browser.
4. In the app: enter a documentation URL (e.g. a Cloudflare or MDN docs page), click **Load doc**, then type questions and click **Ask**.

**Try deployed**

After running `npm run deploy`, use the Workers URL Wrangler outputs (e.g. `https://one-url-doc-qa.<your-subdomain>.workers.dev`) and follow the same steps as above.

## Requirements

- Node.js 18+
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI
- Cloudflare account with Workers AI and Durable Objects enabled

## Deploy

```bash
npm run deploy
```

Durable Objects use SQLite storage (`new_sqlite_classes` in `wrangler.toml`), required on Cloudflare’s free plan.

## Project layout

- `src/server.ts` – Worker: session cookie, forwards `/api/*` to the Durable Object, serves static from `public/`.
- `src/DocSession.ts` – Durable Object: `/set-url` (fetch, strip HTML, chunk, persist), `/ask` (keyword retrieval + Llama 3.3 stream), `/status` (url/chunks/messages count).
- `public/index.html`, `public/app.js` – Frontend: URL input, chat UI, streamed answers (SSE parsing).

## API

- `POST /api/set-url` – Body: `{ "url": "https://..." }`. Loads and chunks the page for this session.
- `POST /api/ask` – Body: `{ "message": "..." }`. Returns a streamed SSE response (Workers AI format).
- `GET /api/status` – Returns `{ url, chunks, messages }` for the current session.

## AI-assisted development

AI prompts used to build this project are documented in [PROMPTS.md](./PROMPTS.md).

## License

MIT
