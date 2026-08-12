import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.resolve(
  currentDir,
  "../2026-08-11-ai-learning-assistant-integration"
);

async function exists(relativePath) {
  try {
    await access(path.join(targetDir, relativePath));
    return true;
  } catch {
    return false;
  }
}

const readme = await readFile(path.join(currentDir, "README.md"), "utf8");

async function packageFileExists(relativePath) {
  try {
    await access(path.join(currentDir, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function hasCompletedLimitations() {
  try {
    const content = await readFile(path.join(currentDir, "LIMITATIONS.md"), "utf8");
    return (
      content.includes("## 当前限制") &&
      content.includes("## 后续路线") &&
      !content.includes("TODO")
    );
  } catch {
    return false;
  }
}

const checks = [
  {
    id: "readme",
    label: "README 包含目标与可复制的运行命令",
    passed:
      readme.includes("# Agent 交付检查 Demo") &&
      readme.includes("node delivery-check.mjs")
  },
  {
    id: "architecture",
    label: "独立架构说明",
    passed: await packageFileExists("ARCHITECTURE.md")
  },
  {
    id: "demo-script",
    label: "可直接运行的演示脚本",
    passed: await exists("demo.mjs")
  },
  {
    id: "eval-report",
    label: "人能阅读的 Eval 报告",
    passed: await packageFileExists("EVAL_REPORT.md")
  },
  {
    id: "limitations-roadmap",
    label: "限制与后续路线",
    passed: await hasCompletedLimitations()
  }
];

const missing = checks.filter((check) => !check.passed);

console.log(
  JSON.stringify(
    {
      target: targetDir,
      ready: missing.length === 0,
      checks,
      missing: missing.map(({ id, label }) => ({ id, label })),
      note: "脱离笔记复述属于用户证据，不能由文件检查代替。"
    },
    null,
    2
  )
);
