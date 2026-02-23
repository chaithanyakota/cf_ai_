import { DocSession } from "./DocSession";

export { DocSession };

export interface Env {
  DOC_SESSION: DurableObjectNamespace;
  AI: Ai;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
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
        body: request.body,
      });
      let response = await stub.fetch(doRequest);

      if (!hadSession) {
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        });
        response.headers.set(
          "Set-Cookie",
          `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax`
        );
      }
      return response;
    }

    return env.ASSETS.fetch(request);
  },
};
