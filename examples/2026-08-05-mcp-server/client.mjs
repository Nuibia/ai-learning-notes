import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));
const accessMode = process.argv[2] ?? "read-only";

if (!["read-only", "read-write"].includes(accessMode)) {
  throw new Error("访问模式只能是 read-only 或 read-write");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {
    ...process.env,
    MCP_ACCESS_MODE: accessMode,
  },
});
const client = new Client({ name: "学习用 MCP Client", version: "1.0.0" });

await client.connect(transport);

try {
  const discovery = await client.listTools();
  console.log("1. tools/list 发现的工具：");
  console.log(discovery.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  })));

  const result = await client.callTool({
    name: "get_project_by_name",
    arguments: { projectName: "ai-learning-agent" },
  });
  console.log("\n2. tools/call 返回的结果：");
  console.log(result);

  const writeResult = await client.callTool({
    name: "archive_project",
    arguments: { projectName: "ai-learning-agent" },
  });
  console.log(`\n3. ${accessMode} 模式调用写工具：`);
  console.log(writeResult);
} finally {
  await client.close();
}
