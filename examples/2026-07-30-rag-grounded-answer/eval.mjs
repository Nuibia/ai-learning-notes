import assert from "node:assert/strict";

/**
 * L17 最小评测积木
 *
 * 下面的字段名、策略名和诊断标签都是本 Demo 自定义，不是 RAG 社区统一标准。
 * generateFromContext 只是固定行为的“生成器模拟器”，不是真实 LLM。
 * 这样可以只改变检索策略，观察前后差异来自哪一层。
 */
const fragments = {
  片段A: "标准商品付款后 30 天内可申请退款。",
  片段B: "定制商品一旦进入生产，不支持退款。"
};

const evaluationCase = {
  id: "定制商品退款-01",
  question: "定制商品进入生产后可以退款吗？",
  expectedFragmentIds: ["片段B"]
};

const hybridSearchCase = {
  question: "ERR_AUTH_403 是什么原因，应该怎样恢复权限？",
  keywordResults: [
    {
      id: "片段E",
      text: "ERR_AUTH_403 表示当前令牌缺少 invoices:read 权限。"
    }
  ],
  semanticResults: [
    {
      id: "片段F",
      text: "访问被拒绝时，请检查角色权限，并在授权后重新获取令牌。"
    },
    {
      id: "片段G",
      text: "发票模板支持调整页眉颜色和公司 Logo。"
    }
  ],
  rerankScores: {
    片段E: 0.99,
    片段F: 0.96,
    片段G: 0.18
  },
  finalK: 2
};

const smallEvaluationSet = [
  {
    id: "定制商品退款-01",
    expectedFragmentIds: ["片段B"],
    baselineRetrievedIds: ["片段A"],
    improvedRetrievedIds: ["片段B"]
  },
  {
    id: "标准商品退款-01",
    expectedFragmentIds: ["片段A"],
    baselineRetrievedIds: ["片段A"],
    improvedRetrievedIds: ["片段A"]
  },
  {
    id: "权限错误恢复-01",
    expectedFragmentIds: ["片段E", "片段F"],
    baselineRetrievedIds: ["片段E"],
    improvedRetrievedIds: ["片段E", "片段F"]
  }
];

function mergeUniqueResults(...resultGroups) {
  return [
    ...new Map(
      resultGroups.flat().map((fragment) => [fragment.id, fragment])
    ).values()
  ];
}

function rerankCandidates(candidates, scores, finalK) {
  return [...candidates]
    .sort((left, right) => scores[right.id] - scores[left.id])
    .slice(0, finalK);
}

function evaluateRetrievalSet(testCases, retrievedIdsField) {
  const caseResults = testCases.map((testCase) => {
    const retrievedIds = testCase[retrievedIdsField];
    const passed = testCase.expectedFragmentIds.every((fragmentId) =>
      retrievedIds.includes(fragmentId)
    );
    return {
      id: testCase.id,
      expectedFragmentIds: testCase.expectedFragmentIds,
      retrievedIds,
      passed
    };
  });

  const passedCount = caseResults.filter((result) => result.passed).length;
  return {
    total: caseResults.length,
    passedCount,
    passRate: passedCount / caseResults.length,
    caseResults
  };
}

function generateFromContext(contextFragmentIds) {
  if (contextFragmentIds.includes("片段B")) {
    return {
      text: "不可以，定制商品进入生产后不支持退款。[片段B]",
      answerGrounded: true
    };
  }

  return {
    text: "可以，因为付款后 30 天内可申请退款。[片段A]",
    answerGrounded: false
  };
}

function runPipeline({ strategy, retrievedFragmentIds }) {
  const llmContextFragmentIds = [...retrievedFragmentIds];
  return {
    strategy,
    retrievedFragmentIds,
    llmContextFragmentIds,
    answer: generateFromContext(llmContextFragmentIds)
  };
}

function evaluateRun(testCase, run) {
  const expectedWasRetrieved = testCase.expectedFragmentIds.every((fragmentId) =>
    run.retrievedFragmentIds.includes(fragmentId)
  );
  const expectedReachedLlm = testCase.expectedFragmentIds.every((fragmentId) =>
    run.llmContextFragmentIds.includes(fragmentId)
  );

  let failureStage = "none";
  if (!expectedWasRetrieved) {
    failureStage = "retrieval";
  } else if (!expectedReachedLlm) {
    failureStage = "ranking_or_truncation";
  } else if (!run.answer.answerGrounded) {
    failureStage = "generation_or_output_verification";
  }

  return {
    strategy: run.strategy,
    expectedWasRetrieved,
    expectedReachedLlm,
    answerGrounded: run.answer.answerGrounded,
    failureStage
  };
}

const baselineRun = runPipeline({
  strategy: "仅关键词匹配",
  retrievedFragmentIds: ["片段A"]
});
const improvedRun = runPipeline({
  strategy: "商品类型过滤后再做关键词匹配",
  retrievedFragmentIds: ["片段B"]
});

const baselineResult = evaluateRun(evaluationCase, baselineRun);
const improvedResult = evaluateRun(evaluationCase, improvedRun);
const hybridCandidates = mergeUniqueResults(
  hybridSearchCase.keywordResults,
  hybridSearchCase.semanticResults
);
const rerankedCandidates = rerankCandidates(
  hybridCandidates,
  hybridSearchCase.rerankScores,
  hybridSearchCase.finalK
);
const baselineSetResult = evaluateRetrievalSet(
  smallEvaluationSet,
  "baselineRetrievedIds"
);
const improvedSetResult = evaluateRetrievalSet(
  smallEvaluationSet,
  "improvedRetrievedIds"
);

console.log("来源片段：", fragments);
console.log("固定评测案例：", evaluationCase);
console.log("改进前 Trace：", baselineRun);
console.log("改进前评测：", baselineResult);
console.log("改进后 Trace：", improvedRun);
console.log("改进后评测：", improvedResult);
console.log("混合检索案例：", hybridSearchCase.question);
console.log("关键词候选：", hybridSearchCase.keywordResults);
console.log("语义候选：", hybridSearchCase.semanticResults);
console.log("合并后的候选池：", hybridCandidates);
console.log("固定重排分数：", hybridSearchCase.rerankScores);
console.log(`重排后的 Top-${hybridSearchCase.finalK}：`, rerankedCandidates);
console.log("小型问题集｜改进前：", baselineSetResult);
console.log("小型问题集｜改进后：", improvedSetResult);

assert.equal(
  baselineResult.failureStage,
  "retrieval",
  "目标片段没有被召回时，应先定位为检索/召回失败"
);
assert.equal(
  improvedResult.expectedWasRetrieved,
  true,
  "改进后的检索策略应召回目标片段"
);
assert.equal(
  improvedResult.answerGrounded,
  true,
  "同一个生成器模拟器拿到正确上下文后，应给出有依据的回答"
);
assert.deepEqual(
  hybridCandidates.map((fragment) => fragment.id),
  ["片段E", "片段F", "片段G"],
  "混合检索候选池应先保留两条相关片段与一条待重排的干扰片段"
);
assert.deepEqual(
  rerankedCandidates.map((fragment) => fragment.id),
  ["片段E", "片段F"],
  "重排后应保留同时覆盖错误原因与恢复步骤的两个片段"
);
assert.equal(
  baselineSetResult.passedCount,
  1,
  "改进前应只通过标准商品案例"
);
assert.equal(
  improvedSetResult.passedCount,
  3,
  "改进后应通过三条固定案例"
);

console.log("自检通过：前后对照、混合检索、重排和小型问题集评测均符合预期。");
