var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-vCBz1P/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/DocSession.ts
var SYSTEM_PROMPT = `You are a helpful documentation assistant. Use the following documentation excerpts as your primary context: prefer and cite them when they answer the question. You may also use general knowledge to give clearer or more complete explanations when helpful\u2014for example, to define terms, add examples, or clarify how something works in practice. When the doc is relevant, say so and quote or paraphrase it; when you go beyond the doc, keep explanations focused and useful.`;
var CHUNK_SIZE = 600;
var MAX_CHUNKS_FOR_CONTEXT = 8;
function stripHtml(html) {
  const noScript = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  const noStyle = noScript.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  const blockNewline = noStyle.replace(/<\/(p|div|h[1-6]|li|tr|br)\s*>/gi, "\n");
  const text = blockNewline.replace(/<[^>]+>/g, " ");
  return text.replace(/\s+/g, " ").trim();
}
__name(stripHtml, "stripHtml");
function chunkText(text, sourceUrl) {
  const chunks = [];
  const paragraphs = text.split(/\n+/).filter((p) => p.trim().length > 0);
  let current = "";
  let index = 0;
  for (const p of paragraphs) {
    if (current.length + p.length > CHUNK_SIZE && current.length > 0) {
      chunks.push({
        id: `c-${index++}`,
        text: current.trim(),
        sourceUrl
      });
      current = "";
    }
    current += (current ? "\n\n" : "") + p;
  }
  if (current.trim()) {
    chunks.push({
      id: `c-${index}`,
      text: current.trim(),
      sourceUrl
    });
  }
  if (chunks.length === 0 && text.trim()) {
    chunks.push({ id: "c-0", text: text.trim().slice(0, 4e3), sourceUrl });
  }
  return chunks;
}
__name(chunkText, "chunkText");
var DocSession = class {
  url = null;
  chunks = [];
  messages = [];
  state;
  env;
  constructor(ctx, env) {
    this.state = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get("state");
      if (stored) {
        this.url = stored.url ?? null;
        this.chunks = stored.chunks ?? [];
        this.messages = stored.messages ?? [];
      }
    });
  }
  async persist() {
    await this.state.storage.put("state", {
      url: this.url,
      chunks: this.chunks,
      messages: this.messages
    });
  }
  getRelevantChunks(query, k) {
    if (this.chunks.length === 0)
      return [];
    if (this.chunks.length <= k)
      return [...this.chunks];
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (words.length === 0)
      return this.chunks.slice(0, k);
    const scored = this.chunks.map((c) => ({
      chunk: c,
      score: words.filter((w) => c.text.toLowerCase().includes(w)).length
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, k).map((s) => s.chunk);
    const anyMatch = scored.slice(0, k).some((s) => s.score > 0);
    if (!anyMatch)
      return this.chunks.slice(0, k);
    return top;
  }
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === "/set-url" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) {
        return new Response(JSON.stringify({ error: "Missing url" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "OneUrlDocQA/1.0" }
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
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) {
        return new Response(JSON.stringify({ error: "Missing message" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (this.chunks.length === 0) {
        return new Response(
          JSON.stringify({
            error: "No documentation loaded. Set a URL first with /api/set-url."
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      this.messages.push({ role: "user", content: message });
      const relevant = this.getRelevantChunks(message, MAX_CHUNKS_FOR_CONTEXT);
      const context = relevant.map((c) => c.text).join("\n\n---\n\n");
      const lastFew = this.messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n");
      const userPrompt = `Documentation excerpts:

${context}

Conversation:
${lastFew}

Answer the last user question using only the documentation excerpts above.`;
      try {
        const stream = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt }
          ],
          stream: true
        });
        const [streamForClient, streamForCollect] = stream.tee();
        const decoder = new TextDecoder();
        (async () => {
          const parts = [];
          const reader = streamForCollect.getReader();
          const dec = new TextDecoder();
          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done)
                break;
              buffer += dec.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.response != null)
                      parts.push(data.response);
                  } catch (_) {
                  }
                }
              }
            }
            if (buffer.trim().startsWith("data: ")) {
              try {
                const data = JSON.parse(buffer.trim().slice(6));
                if (data.response != null)
                  parts.push(data.response);
              } catch (_) {
              }
            }
            const assistantContent = parts.join("");
            this.messages.push({ role: "assistant", content: assistantContent });
            await this.persist();
          } catch (_) {
          }
        })();
        return new Response(streamForClient, {
          headers: { "Content-Type": "text/event-stream" }
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
          messages: this.messages.length
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("Not found", { status: 404 });
  }
};
__name(DocSession, "DocSession");

// src/server.ts
var server_default = {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const hadSession = request.headers.get("Cookie")?.includes("session_id=");
      let sessionId = request.headers.get("Cookie")?.match(/session_id=([^;]+)/)?.[1];
      if (!sessionId) {
        sessionId = crypto.randomUUID();
      }
      const id = env.DOC_SESSION.idFromName(sessionId);
      const stub = env.DOC_SESSION.get(id);
      const doPath = url.pathname.replace(/^\/api/, "");
      const doRequest = new Request(`http://do${doPath}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });
      let response = await stub.fetch(doRequest);
      if (!hadSession) {
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers)
        });
        response.headers.set(
          "Set-Cookie",
          `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax`
        );
      }
      return response;
    }
    return env.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-vCBz1P/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = server_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-vCBz1P/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  DocSession,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=server.js.map
