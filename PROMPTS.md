# AI prompts used

This file lists the main AI prompts used to build and refine this project (AI-assisted coding).

---

- **Initial project build**  
  “Start building this project: One-URL doc Q&A (no Vectorize). Set URL: user submits one doc URL → Worker fetches page, strips HTML, chunks, stores in Durable Object. Ask: user sends a question → keyword retrieval over chunks, Llama 3.3 with context, stream answer. No Vectorize; state in DO. Frontend: Pages with URL input + chat. Implement set-url, ask, session cookie, DO, and minimal UI.”

- **Front end design**  
  “Integrate the Bold Typography design system into the frontend” (with the full design system spec: dark mode, Inter Tight/Inter, accent, 0 radius, underlines, tokens, etc.).

- **Durable Objects free-plan fix**  
  “What is this error: In order to use Durable Objects with a free plan, you must create a namespace using a new_sqlite_classes migration.” Followed by: “Make the changes needed.”
