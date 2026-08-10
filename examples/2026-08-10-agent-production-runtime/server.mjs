import http from "node:http";
import { pathToFileURL } from "node:url";

import { evaluateRelease } from "./rollback.mjs";

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function createAppServer({ env = process.env } = {}) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, "http://runtime.local");

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        releaseVersion: env.RELEASE_VERSION ?? "dev"
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/ready") {
      const ready = Boolean(env.DEMO_EMAIL_TOKEN);
      sendJson(response, ready ? 200 : 503, {
        status: ready ? "ready" : "configuration_error",
        secretConfigured: ready
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/drill") {
      const healthOk = url.searchParams.get("healthOk") === "true";
      const errorRate = Number(url.searchParams.get("errorRate") ?? 0);
      const result = evaluateRelease({
        stableVersion: "v1",
        candidateVersion: env.RELEASE_VERSION ?? "v2",
        signals: { healthOk, errorRate },
        policy: { maxErrorRate: 0.05 }
      });
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { status: "not_found" });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  const server = createAppServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Agent production Runtime listening on http://127.0.0.1:${port}`);
  });
}
