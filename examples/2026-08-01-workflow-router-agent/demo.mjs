const handlers = {
  faq: "faqHandler",
  refund: "refundHandler",
  account: "accountHandler",
};

/**
 * 第一步：当输入已经是固定枚举时，让代码稳定选择处理器。
 * 这里还没有 Workflow 或 Agent，后续学习时再逐块加入。
 */
export function routeByKind({ kind, question }) {
  const handler = handlers[kind];

  if (!handler) {
    throw new Error("UNKNOWN_KIND");
  }

  return {
    route: kind,
    handler,
    question,
    decisionOwner: "runtime_code",
  };
}

/**
 * 第二步：没有结构化 kind 时，才调用语义分类器。
 * 分类器可以由 LLM 实现，但它的输出仍必须经过 Runtime 的固定校验。
 */
export async function routeByText({ question, classifyIntent }) {
  const kind = await classifyIntent(question);
  const route = routeByKind({ kind, question });

  return {
    ...route,
    decisionOwner: "llm_classification_then_runtime_validation",
  };
}

/**
 * 第三步：Workflow 的执行顺序由代码预先规定。
 * Router 和回答生成可以使用 LLM，但模型不能改变步骤顺序。
 */
export async function runSupportWorkflow({
  question,
  classifyIntent,
  loadPolicy,
  generateAnswer,
}) {
  const trace = [];

  trace.push("1.route");
  const route = await routeByText({ question, classifyIntent });

  trace.push("2.load_policy");
  const policy = await loadPolicy(route.route);

  trace.push("3.generate_answer");
  const answer = await generateAnswer({ question, policy });

  return { route: route.route, answer, trace };
}

const reimbursementKinds = new Set(["travel", "meal", "office"]);

// 以下状态值、错误码和字段名都是本 Demo 的本地命名，不是框架规范。

/**
 * 实践补充：把用户设计的报销 SOP 落成固定 Workflow。
 * LLM 可以负责分类，但分类校验、分支和是否允许写入都由 Runtime 控制。
 */
export async function runReimbursementWorkflow({
  text,
  amount,
  classifyIntent,
  loadPolicy,
  validateFields,
  createRecord,
}) {
  const trace = ["1.classify"];
  const kind = await classifyIntent(text);

  if (!reimbursementKinds.has(kind)) {
    throw new Error("UNKNOWN_REIMBURSEMENT_KIND");
  }

  trace.push("2.load_policy");
  const policy = await loadPolicy(kind);

  trace.push("3.validate_fields");
  const missing = await validateFields({ text, amount, kind, policy });

  if (missing.length > 0) {
    return { status: "missing_fields", kind, missing, trace };
  }

  if (amount > 5000) {
    return { status: "waiting_confirmation", kind, amount, trace };
  }

  trace.push("4.create_record");
  const record = await createRecord({ text, amount, kind, policy });

  return { status: "completed", kind, record, trace };
}

/**
 * 第四步：Agent 的下一步由模型动态决定。
 * Runtime 不预设工具顺序，但仍负责工具白名单和最大步数。
 */
export async function runSupportAgent({ goal, decideNext, tools, maxSteps = 4 }) {
  const observations = [];
  const trace = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const action = await decideNext({ goal, observations });

    if (action.type === "final") {
      trace.push("model:final");
      return { answer: action.content, trace };
    }

    if (action.type !== "tool_call" || !tools[action.tool]) {
      throw new Error("TOOL_NOT_ALLOWED");
    }

    trace.push(`model:${action.tool}`);
    const result = await tools[action.tool](action.args ?? {});
    observations.push({ action, result });
    trace.push(`tool:${action.tool}`);
  }

  throw new Error("MAX_STEPS_EXCEEDED");
}

console.log(
  routeByKind({
    kind: "refund",
    question: "定制商品可以退款吗？",
  }),
);

try {
  routeByKind({ kind: "other", question: "未知类型" });
} catch (error) {
  console.log({ error: error.message });
}

console.log(
  await routeByText({
    question: "我买的定制水杯不想要了，可以退吗？",
    async classifyIntent() {
      // 这里模拟 LLM 对自然语言做语义分类。
      return "refund";
    },
  }),
);

console.log(
  await runSupportWorkflow({
    question: "我买的定制水杯不想要了，可以退吗？",
    async classifyIntent() {
      return "refund";
    },
    async loadPolicy(kind) {
      return kind === "refund" ? "定制商品不支持无理由退款" : "暂无规则";
    },
    async generateAnswer({ policy }) {
      // 这里模拟 LLM 根据已加载规则生成自然语言回答。
      return `根据规则：${policy}`;
    },
  }),
);

const plannedActions = [
  { type: "tool_call", tool: "lookup_order", args: { orderId: "A100" } },
  { type: "tool_call", tool: "load_policy", args: { kind: "refund" } },
  { type: "final", content: "订单仍在退款处理中，预计两个工作日到账。" },
];

console.log(
  await runSupportAgent({
    goal: "调查订单 A100 的退款为什么还没有到账",
    async decideNext() {
      // 这里模拟 LLM 根据目标和已有观察结果动态决定下一步。
      return plannedActions.shift();
    },
    tools: {
      async lookup_order() {
        return { status: "refunding" };
      },
      async load_policy() {
        return { arrivalTime: "两个工作日" };
      },
    },
  }),
);

console.log("\n=== 用户设计的报销 Workflow ===");

try {
  await runReimbursementWorkflow({
    text: "申请医疗费报销",
    amount: 100,
    async classifyIntent() {
      return "medical";
    },
  });
} catch (error) {
  console.log({ case: "非法类型", error: error.message });
}

console.log(
  await runReimbursementWorkflow({
    text: "申请出差高铁票报销，但没有发票",
    amount: 300,
    async classifyIntent() {
      return "travel";
    },
    async loadPolicy() {
      return { requiredFields: ["invoice"] };
    },
    async validateFields() {
      return ["invoice"];
    },
    async createRecord() {
      throw new Error("UNEXPECTED_CREATE_RECORD");
    },
  }),
);

console.log(
  await runReimbursementWorkflow({
    text: "申请出差住宿费报销",
    amount: 6000,
    async classifyIntent() {
      return "travel";
    },
    async loadPolicy() {
      return { requiredFields: ["invoice"] };
    },
    async validateFields() {
      return [];
    },
    async createRecord() {
      throw new Error("UNEXPECTED_CREATE_RECORD");
    },
  }),
);

let createRecordCalls = 0;
console.log(
  await runReimbursementWorkflow({
    text: "申请办公用品报销",
    amount: 5000,
    async classifyIntent() {
      return "office";
    },
    async loadPolicy() {
      return { requiredFields: ["invoice"] };
    },
    async validateFields() {
      return [];
    },
    async createRecord() {
      createRecordCalls += 1;
      return { id: "R100", status: "created" };
    },
  }),
);
console.log({ createRecordCalls });
