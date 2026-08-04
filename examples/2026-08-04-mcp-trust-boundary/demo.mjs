import assert from "node:assert/strict";

const DEMO_TOKEN = "demo-token-never-print";

class EventLog {
  constructor() {
    this.events = [];
  }

  add(actor, action) {
    this.events.push({ actor, action });
  }

  print() {
    for (const [index, event] of this.events.entries()) {
      console.log(`${String(index + 1).padStart(2, "0")}. ${event.actor}：${event.action}`);
    }
  }
}

class FakeGitLabApi {
  constructor(log) {
    this.log = log;
    this.requestCount = 0;
  }

  getProjectByName({ name, authorization }) {
    this.requestCount += 1;
    assert.equal(authorization, `Bearer ${DEMO_TOKEN}`, "GitLab API 拒绝无效凭证");
    this.log.add("GitLab API", `校验凭证并查询项目 ${name}`);
    return { id: 42, name, visibility: "private" };
  }
}

class GitLabMcpServer {
  constructor({ api, log }) {
    this.api = api;
    this.log = log;
    this.running = false;
    this.startedBy = null;
    this.envToken = null;
  }

  start({ owner, envToken = null }) {
    this.running = true;
    this.startedBy = owner;
    this.envToken = envToken;
    this.log.add("运行环境", `启动 MCP Server；生命周期负责人=${owner}`);
  }

  listTools() {
    this.ensureRunning();
    this.log.add("MCP Server", "返回 tools/list 结果");
    return [
      {
        name: "get_project_by_name",
        description: "按项目名查询 GitLab 项目",
        inputSchema: { type: "object", required: ["name"] },
      },
    ];
  }

  callTool({ name, args, authorization, requestUrl = "/mcp" }) {
    this.ensureRunning();
    const url = new URL(requestUrl, "https://mcp.company.com");

    if (url.searchParams.has("token")) {
      this.log.add("MCP Server", "拒绝 URL 查询参数中的 token，未调用 GitLab API");
      throw new Error("信任边界违规：access token 不得进入 URI query string");
    }

    assert.equal(name, "get_project_by_name", `未知 Tool：${name}`);
    this.log.add("MCP Server", `执行 Tool 处理器 ${name}`);
    return this.api.getProjectByName({
      name: args.name,
      authorization: authorization ?? `Bearer ${this.envToken}`,
    });
  }

  ensureRunning() {
    assert.equal(this.running, true, "MCP Server 尚未启动");
  }
}

class StdioTransport {
  constructor({ server, token, log }) {
    this.server = server;
    this.token = token;
    this.log = log;
  }

  connect() {
    this.server.start({
      owner: "Codex MCP Client 的 stdio transport",
      envToken: this.token,
    });
    this.log.add("MCP Client", "通过 stdin/stdout 建立连接");
  }

  listTools() {
    return this.server.listTools();
  }

  callTool(payload) {
    return this.server.callTool(payload);
  }
}

class StreamableHttpTransport {
  constructor({ server, token, log, unsafeQueryToken = false }) {
    this.server = server;
    this.token = token;
    this.log = log;
    this.unsafeQueryToken = unsafeQueryToken;
  }

  connect() {
    assert.equal(this.server.running, true, "远程 MCP Server 应由部署系统预先启动");
    this.log.add("MCP Client", "连接已独立运行的远程 /mcp；不负责启动 Server");
  }

  listTools() {
    return this.server.listTools();
  }

  callTool(payload) {
    if (this.unsafeQueryToken) {
      return this.server.callTool({
        ...payload,
        requestUrl: `/mcp?token=${this.token}`,
      });
    }

    return this.server.callTool({
      ...payload,
      authorization: `Bearer ${this.token}`,
    });
  }
}

class McpClient {
  constructor({ transport, log }) {
    this.transport = transport;
    this.log = log;
  }

  runUserRequest(userText) {
    this.transport.connect();
    const tools = this.transport.listTools();

    const llmContext = {
      userText,
      tools,
      selectedTool: "get_project_by_name",
      arguments: { name: "ai-learning-agent" },
    };

    assert.equal(JSON.stringify(llmContext).includes(DEMO_TOKEN), false, "token 泄露进 LLM 上下文");
    this.log.add("Host / LLM", "只看到 Tool 描述与参数，看不到 token");
    this.log.add("MCP Client", "发送 tools/call");

    return this.transport.callTool({
      name: llmContext.selectedTool,
      args: llmContext.arguments,
    });
  }
}

function buildScenario(mode) {
  const log = new EventLog();
  const api = new FakeGitLabApi(log);
  const server = new GitLabMcpServer({ api, log });

  if (mode === "stdio") {
    return {
      log,
      api,
      server,
      client: new McpClient({
        log,
        transport: new StdioTransport({ server, token: DEMO_TOKEN, log }),
      }),
    };
  }

  server.start({ owner: "公司服务器上的部署系统" });
  return {
    log,
    api,
    server,
    client: new McpClient({
      log,
      transport: new StreamableHttpTransport({
        server,
        token: DEMO_TOKEN,
        log,
        unsafeQueryToken: mode === "http-unsafe",
      }),
    }),
  };
}

function main() {
  const mode = process.argv[2] ?? "stdio";
  const allowedModes = ["stdio", "http-safe", "http-unsafe"];
  assert.ok(allowedModes.includes(mode), `模式只能是：${allowedModes.join("、")}`);

  console.log(`\n运行模式：${mode}\n`);
  const scenario = buildScenario(mode);

  try {
    const result = scenario.client.runUserRequest("查找 ai-learning-agent 项目");
    scenario.log.add("Host / UI", `展示 Tool Result：${result.name}`);
  } catch (error) {
    scenario.log.add("Host / UI", `收到失败结果：${error.message}`);
  }

  scenario.log.print();
  console.log(`\n观察结果：Server 生命周期负责人=${scenario.server.startedBy}`);
  console.log(`GitLab API 实际请求次数=${scenario.api.requestCount}`);
}

main();
