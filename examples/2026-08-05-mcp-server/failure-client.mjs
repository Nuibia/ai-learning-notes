import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));
const client = new Client({ name: "失败处理练习 Client", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, MCP_ACCESS_MODE: "read-only" },
});

await client.connect(transport);

try {
  const toolFailure = await client.callTool({
    name: "get_project_by_name",
    arguments: { projectName: "not-exists" },
  });
  console.log("1. 工具执行失败仍返回 Tool Result：");
  console.log(toolFailure);

  try {
    await client.request(
      { method: "demo/method_not_registered", params: {} },
      EmptyResultSchema,
    );
  } catch (error) {
    console.log("\n2. 无法路由的方法返回协议错误：");
    console.log({ name: error.name, code: error.code, message: error.message });
  }
} finally {
  await client.close();
}
