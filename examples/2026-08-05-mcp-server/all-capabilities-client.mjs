import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));
const client = new Client({ name: "完整能力演示 Client", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, MCP_ACCESS_MODE: "read-only" },
});

await client.connect(transport);

try {
  const tools = await client.listTools();
  console.log("1. tools/list：", tools.tools.map((item) => item.name));

  const toolResult = await client.callTool({
    name: "get_project_by_name",
    arguments: { projectName: "ai-learning-agent" },
  });
  console.log("2. tools/call：", toolResult.content[0].text);

  const resources = await client.listResources();
  console.log("3. resources/list：", resources.resources.map((item) => item.uri));

  const resourceResult = await client.readResource({ uri: "project://catalog" });
  console.log("4. resources/read：", resourceResult.contents[0].text);

  const prompts = await client.listPrompts();
  console.log("5. prompts/list：", prompts.prompts.map((item) => item.name));

  const promptResult = await client.getPrompt({
    name: "review_project",
    arguments: { projectName: "ai-learning-agent" },
  });
  console.log("6. prompts/get：", promptResult.messages[0]);
} finally {
  await client.close();
}
