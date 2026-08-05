import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const projects = [
  { id: 1, name: "ai-learning-agent", visibility: "private", archived: false },
  { id: 2, name: "ai-learning-notes", visibility: "public", archived: false },
];

const server = new McpServer({
  name: "学习用项目查询 MCP Server",
  version: "1.0.0",
});

server.registerResource(
  "project_catalog",
  "project://catalog",
  {
    title: "项目目录",
    description: "MCP Server 当前管理的项目资料。",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(projects, null, 2),
      },
    ],
  }),
);

server.registerPrompt(
  "review_project",
  {
    title: "项目审查模板",
    description: "生成一条供用户选择使用的项目审查消息。",
    argsSchema: {
      projectName: z.string().min(1).describe("需要审查的项目名称"),
    },
  },
  ({ projectName }) => ({
    description: `审查项目 ${projectName}`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `请审查项目 ${projectName}，说明它的可见性、归档状态和潜在风险。`,
        },
      },
    ],
  }),
);

server.registerTool(
  "get_project_by_name",
  {
    title: "按名称查询项目",
    description: "从演示数据中按完整名称查询一个项目，只读取数据，不产生写入副作用。",
    inputSchema: {
      projectName: z.string().min(1).describe("项目的完整名称"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  async ({ projectName }) => {
    const project = projects.find((item) => item.name === projectName);

    if (!project) {
      return {
        isError: true,
        content: [{ type: "text", text: `未找到项目：${projectName}` }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(project) }],
    };
  },
);

server.registerTool(
  "archive_project",
  {
    title: "归档项目",
    description: "修改项目状态，将指定项目标记为已归档。",
    inputSchema: {
      projectName: z.string().min(1).describe("需要归档的项目完整名称"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({ projectName }) => {
    // annotations 只是提示；真正的写权限必须由 Server 自己强制校验。
    if (process.env.MCP_ACCESS_MODE !== "read-write") {
      return {
        isError: true,
        content: [{ type: "text", text: "权限不足：当前连接只有只读权限" }],
      };
    }

    const project = projects.find((item) => item.name === projectName);
    if (!project) {
      return {
        isError: true,
        content: [{ type: "text", text: `未找到项目：${projectName}` }],
      };
    }

    project.archived = true;
    return {
      content: [{ type: "text", text: JSON.stringify(project) }],
    };
  },
);

await server.connect(new StdioServerTransport());
