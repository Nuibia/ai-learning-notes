import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AgentRuntime } from "./runtime.mjs";

const runtime = new AgentRuntime();
const htmlPath = fileURLToPath(new URL("./public/index.html", import.meta.url));

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendSse(response, event) {
  response.write(`id: ${event.id}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await readFile(htmlPath));
      return;
    }

    if (request.method === "POST" && request.url === "/api/messages") {
      const { message } = await readJson(request);
      const run = runtime.createRun(message);
      sendJson(response, 201, { runId: run.id, status: run.status });
      return;
    }

    const eventsMatch = request.url?.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (request.method === "GET" && eventsMatch) {
      const runId = eventsMatch[1];
      const lastEventId = Number(request.headers["last-event-id"] ?? -1);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      let endedDuringReplay = false;
      let unsubscribe = () => {};
      unsubscribe = runtime.subscribe(
        runId,
        (event) => {
          sendSse(response, event);
          if (["response.completed", "response.cancelled"].includes(event.type)) {
            endedDuringReplay = true;
            unsubscribe();
            response.end();
          }
        },
        lastEventId + 1
      );
      if (endedDuringReplay) unsubscribe();
      request.on("close", unsubscribe);
      return;
    }

    const confirmMatch = request.url?.match(/^\/api\/runs\/([^/]+)\/confirm$/);
    if (request.method === "POST" && confirmMatch) {
      const { approved } = await readJson(request);
      const run = runtime.confirmRun(confirmMatch[1], approved === true);
      sendJson(response, 200, {
        runId: run.id,
        status: run.status,
        result: run.result
      });
      return;
    }

    sendJson(response, 404, { error: "路由不存在" });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`L13 Demo 已启动：http://localhost:${port}`);
});
