export interface Env {
  AI: Ai;
}

interface Chunk {
  id: string;
  text: string;
  sourceUrl: string;
}

interface StoredState {
  url: string | null;
  chunks: Chunk[];
  messages: { role: "user" | "assistant"; content: string }[];
}

const SYSTEM_PROMPT = `You are a helpful documentation assistant. Use the following documentation excerpts as your primary context: prefer and cite them when they answer the question. You may also use general knowledge to give clearer or more complete explanations when helpful—for example, to define terms, add examples, or clarify how something works in practice. When the doc is relevant, say so and quote or paraphrase it; when you go beyond the doc, keep explanations focused and useful.`;

const CHUNK_SIZE = 600;
const MAX_CHUNKS_FOR_CONTEXT = 8;

function stripHtml(html: string): string {
  const noScript = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  const noStyle = noScript.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  const blockNewline = noStyle.replace(/<\/(p|div|h[1-6]|li|tr|br)\s*>/gi, "\n");
  const text = blockNewline.replace(/<[^>]+>/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

function chunkText(text: string, sourceUrl: string): Chunk[] {
  const chunks: Chunk[] = [];
  const paragraphs = text.split(/\n+/).filter((p) => p.trim().length > 0);
  let current = "";
  let index = 0;

  for (const p of paragraphs) {
    if (current.length + p.length > CHUNK_SIZE && current.length > 0) {
      chunks.push({
        id: `c-${index++}`,
        text: current.trim(),
        sourceUrl,
      });
      current = "";
    }
    current += (current ? "\n\n" : "") + p;
  }
  if (current.trim()) {
    chunks.push({
      id: `c-${index}`,
      text: current.trim(),
      sourceUrl,
    });
  }

  if (chunks.length === 0 && text.trim()) {
    chunks.push({ id: "c-0", text: text.trim().slice(0, 4000), sourceUrl });
  }
  return chunks;
}

export class DocSession implements DurableObject {
  private url: string | null = null;
  private chunks: Chunk[] = [];
  private messages: { role: "user" | "assistant"; content: string }[] = [];
  private state: DurableObjectState;
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.state = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<StoredState>("state");
      if (stored) {
        this.url = stored.url ?? null;
        this.chunks = (stored.chunks ?? []) as Chunk[];
        this.messages = (stored.messages ?? []) as typeof this.messages;
      }
    });
  }

  private async persist(): Promise<void> {
    await this.state.storage.put("state", {
      url: this.url,
      chunks: this.chunks,
      messages: this.messages,
    } as StoredState);
  }

  private getRelevantChunks(query: string, k: number): Chunk[] {
    if (this.chunks.length === 0) return [];
    if (this.chunks.length <= k) return [...this.chunks];

    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);
    if (words.length === 0) return this.chunks.slice(0, k);

    const scored = this.chunks.map((c) => ({
      chunk: c,
      score: words.filter((w) => c.text.toLowerCase().includes(w)).length,
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, k).map((s) => s.chunk);
    const anyMatch = scored.slice(0, k).some((s) => s.score > 0);
    if (!anyMatch) return this.chunks.slice(0, k);
    return top;
  }

  async fetch(request: Request): Promise<Response> {
    const u = new URL(request.url);

    if (u.pathname === "/set-url" && request.method === "POST") {
      let body: { url?: string };
      try {
        body = (await request.json()) as { url?: string };
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) {
        return new Response(JSON.stringify({ error: "Missing url" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "OneUrlDocQA/1.0" },
        });
        if (!res.ok) {
          return new Response(
            JSON.stringify({ error: `Fetch failed: ${res.status}` }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        const html = await res.text();
        const text = stripHtml(html);
        this.chunks = chunkText(text, url);
        this.url = url;
        this.messages = [];
        await this.persist();
        return new Response(
          JSON.stringify({ ok: true, chunks: this.chunks.length, url }),
          { headers: { "Content-Type": "application/json" } }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return new Response(
          JSON.stringify({ error: `Failed to load URL: ${msg}` }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    if (u.pathname === "/ask" && request.method === "POST") {
      let body: { message?: string };
      try {
        body = (await request.json()) as { message?: string };
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) {
        return new Response(JSON.stringify({ error: "Missing message" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (this.chunks.length === 0) {
        return new Response(
          JSON.stringify({
            error: "No documentation loaded. Set a URL first with /api/set-url.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      this.messages.push({ role: "user", content: message });
      const relevant = this.getRelevantChunks(message, MAX_CHUNKS_FOR_CONTEXT);
      const context = relevant.map((c) => c.text).join("\n\n---\n\n");
      const lastFew = this.messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n");
      const userPrompt = `Documentation excerpts:\n\n${context}\n\nConversation:\n${lastFew}\n\nAnswer the last user question using only the documentation excerpts above.`;

      try {
        const stream = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          stream: true,
        }) as ReadableStream<Uint8Array>;

        const [streamForClient, streamForCollect] = stream.tee();
        const decoder = new TextDecoder();
        (async () => {
          const parts: string[] = [];
          const reader = streamForCollect.getReader();
          const dec = new TextDecoder();
          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += dec.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const data = JSON.parse(line.slice(6)) as { response?: string };
                    if (data.response != null) parts.push(data.response);
                  } catch (_) {}
                }
              }
            }
            if (buffer.trim().startsWith("data: ")) {
              try {
                const data = JSON.parse(buffer.trim().slice(6)) as { response?: string };
                if (data.response != null) parts.push(data.response);
              } catch (_) {}
            }
            const assistantContent = parts.join("");
            this.messages.push({ role: "assistant", content: assistantContent });
            await this.persist();
          } catch (_) {}
        })();

        return new Response(streamForClient, {
          headers: { "Content-Type": "text/event-stream" },
        });
      } catch (e) {
        this.messages.pop();
        const msg = e instanceof Error ? e.message : "Unknown error";
        return new Response(
          JSON.stringify({ error: `AI error: ${msg}` }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    if (u.pathname === "/status" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          url: this.url,
          chunks: this.chunks.length,
          messages: this.messages.length,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not found", { status: 404 });
  }
}
