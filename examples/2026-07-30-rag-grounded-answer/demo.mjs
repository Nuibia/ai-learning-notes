import assert from "node:assert/strict";

const sourceFragments = [
  {
    id: "片段A",
    text: "标准商品付款后 30 天内可申请退款。",
    facts: {
      productType: "标准商品",
      refundable: true,
      refundWithinDays: 30
    }
  },
  {
    id: "片段B",
    text: "定制商品一旦进入生产，不支持退款。",
    facts: {
      productType: "定制商品",
      productionStatus: "已进入生产",
      refundable: false
    }
  }
];

const candidateAnswer = {
  question: "定制商品付款 20 天后可以退款吗？",
  text: "可以，因为仍在付款后 30 天内。",
  claim: {
    text: "定制商品付款 20 天后可以退款",
    requiredFacts: {
      productType: "定制商品",
      refundable: true
    },
    citationIds: ["片段A"]
  }
};

const correctedAnswer = {
  question: candidateAnswer.question,
  text: "现有信息不足，暂时无法确定是否可以退款。已知只有：定制商品进入生产后不支持退款。[片段B]",
  claim: {
    text: "定制商品进入生产后不支持退款",
    requiredFacts: {
      productType: "定制商品",
      productionStatus: "已进入生产",
      refundable: false
    },
    citationIds: ["片段B"]
  }
};

const multiClaimAnswer = {
  question: candidateAnswer.question,
  text: "定制商品进入生产后不支持退款，而且退款审核会在 3 天内完成。[片段B]",
  claims: [
    {
      text: "定制商品进入生产后不支持退款",
      requiredFacts: {
        productType: "定制商品",
        productionStatus: "已进入生产",
        refundable: false
      },
      citationIds: ["片段B"]
    },
    {
      text: "退款审核会在 3 天内完成",
      requiredFacts: {
        reviewWithinDays: 3
      },
      citationIds: ["片段B"]
    }
  ]
};

function verifyClaim(claim, fragments) {
  const citedFacts = Object.assign(
    {},
    ...claim.citationIds.map((citationId) => {
      const fragment = fragments.find((item) => item.id === citationId);
      return fragment?.facts ?? {};
    })
  );

  const unsupportedFacts = Object.entries(claim.requiredFacts)
    .filter(([key, value]) => citedFacts[key] !== value)
    .map(([key, expected]) => ({
      key,
      expected,
      observed: citedFacts[key] ?? null
    }));

  return {
    claim: claim.text,
    citationIds: claim.citationIds,
    verdict: unsupportedFacts.length === 0 ? "supported" : "unsupported",
    unsupportedFacts
  };
}

function verifyAnswer(answer, fragments) {
  const claimResults = answer.claims.map((claim) => verifyClaim(claim, fragments));
  return {
    verdict: claimResults.every((result) => result.verdict === "supported")
      ? "supported"
      : "unsupported",
    claimResults
  };
}

function buildGroundedResponse(answer, fragments) {
  const claimResults = answer.claims.map((claim) => ({
    claim,
    verification: verifyClaim(claim, fragments)
  }));
  const supportedClaims = claimResults.filter(
    ({ verification }) => verification.verdict === "supported"
  );
  const unsupportedClaims = claimResults.filter(
    ({ verification }) => verification.verdict === "unsupported"
  );

  const supportedText = supportedClaims.map(({ claim }) =>
    `${claim.text}。[${claim.citationIds.join("、")}]`
  );
  const refusalText = unsupportedClaims.map(({ claim }) =>
    `关于“${claim.text}”，现有资料没有依据，无法确认。`
  );

  return {
    status: supportedClaims.length === 0
      ? "refused"
      : unsupportedClaims.length === 0
        ? "answered"
        : "partially_answered",
    text: [...supportedText, ...refusalText].join("\n")
  };
}

const communityPatterns = [
  {
    id: "prompt_only_direct_stream",
    description: "只用 Prompt 要求依据来源回答，然后直接流式输出",
    tradeoff: "首字快、成本低，但不能保证每个结论都被来源支持"
  },
  {
    id: "chunk_guarded_stream",
    description: "按句子或 token 块暂存，核验当前块后再发送",
    tradeoff: "在首字延迟和安全之间折中，但跨块语义核验更复杂"
  },
  {
    id: "full_buffer_guarded",
    description: "暂存完整候选回答，完成全量核验后再输出或重新流式发送",
    tradeoff: "最容易做完整核验，但真实首字延迟最高"
  }
];

function runFullBufferPipeline(answer, fragments) {
  const internalTrace = [
    {
      type: "model.draft.completed",
      visibleToUI: false,
      text: answer.text
    }
  ];
  const safeResponse = buildGroundedResponse(answer, fragments);
  internalTrace.push({
    type: "grounding.verification.completed",
    visibleToUI: false,
    status: safeResponse.status
  });
  const safeChunks = safeResponse.text.match(/.{1,18}/gs) ?? [];

  return {
    internalTrace,
    uiEvents: [
      ...safeChunks.map((delta) => ({
        type: "response.output_text.delta",
        visibleToUI: true,
        delta
      })),
      {
        type: "response.completed",
        visibleToUI: true
      }
    ]
  };
}

function renderVerifiedClaim(claim, verification) {
  if (verification.verdict === "supported") {
    return `${claim.text}。[${claim.citationIds.join("、")}]`;
  }

  return `关于“${claim.text}”，现有资料没有依据，无法确认。`;
}

/**
 * Demo 自定义配置：
 * - streamFirst=false：先核验当前结论块，通过或改写后再发给 UI。
 * - streamFirst=true：先把原始结论块发给 UI，再做核验。
 *
 * streamFirst 只是本 Demo 的字段名。它借鉴了部分 Guardrails 框架的配置思路，
 * 不是 RAG 或 Agent 社区统一术语。
 */
function runChunkGuardedPipeline(
  answer,
  fragments,
  { streamFirst = false } = {}
) {
  const internalTrace = [];
  const uiEvents = [];

  for (const claim of answer.claims) {
    internalTrace.push({
      type: "model.claim_chunk.ready",
      visibleToUI: false,
      claim: claim.text
    });

    if (streamFirst) {
      uiEvents.push({
        type: "response.output_text.delta",
        visibleToUI: true,
        delta: `${claim.text}。`,
        verifiedBeforeSend: false
      });
    }

    const verification = verifyClaim(claim, fragments);
    internalTrace.push({
      type: "grounding.claim_verification.completed",
      visibleToUI: false,
      claim: claim.text,
      verdict: verification.verdict
    });

    if (!streamFirst) {
      uiEvents.push({
        type: "response.output_text.delta",
        visibleToUI: true,
        delta: renderVerifiedClaim(claim, verification),
        verifiedBeforeSend: true
      });
    } else if (verification.verdict === "unsupported") {
      uiEvents.push({
        type: "grounding.violation",
        visibleToUI: true,
        claim: claim.text,
        note: "只能事后告警；无依据内容已经暴露给 UI"
      });
    }
  }

  uiEvents.push({
    type: "response.completed",
    visibleToUI: true
  });

  return {
    demoConfig: { streamFirst },
    internalTrace,
    uiEvents
  };
}

console.log("问题：", candidateAnswer.question);
console.log("候选回答：", candidateAnswer.text);
console.log("来源片段：", sourceFragments);
console.log("核验结果：", verifyClaim(candidateAnswer.claim, sourceFragments));
console.log("\n修正回答：", correctedAnswer.text);
console.log("修正后的核验结果：", verifyClaim(correctedAnswer.claim, sourceFragments));
console.log("\n多结论回答：", multiClaimAnswer.text);
console.log("逐条核验结果：", verifyAnswer(multiClaimAnswer, sourceFragments));
console.log("Runtime 最终输出：", buildGroundedResponse(multiClaimAnswer, sourceFragments));
console.log("\n社区常见模式（不是统一标准）：");
console.table(communityPatterns);
const verifyBeforeSend = runChunkGuardedPipeline(
  multiClaimAnswer,
  sourceFragments,
  { streamFirst: false }
);
const sendBeforeVerify = runChunkGuardedPipeline(
  multiClaimAnswer,
  sourceFragments,
  { streamFirst: true }
);

console.log("分块核验：先核验后发送：", verifyBeforeSend);
console.log("分块核验：先发送后核验：", sendBeforeVerify);
console.log("完整缓存方案的输出闸门：", runFullBufferPipeline(multiClaimAnswer, sourceFragments));

const unsupportedRawDelta = "退款审核会在 3 天内完成。";
assert.equal(
  verifyBeforeSend.uiEvents.some((event) => event.delta === unsupportedRawDelta),
  false,
  "先核验后发送时，无依据的肯定结论不应直接暴露给 UI"
);
assert.equal(
  sendBeforeVerify.uiEvents.some((event) => event.delta === unsupportedRawDelta),
  true,
  "先发送后核验时，无依据的肯定结论已经暴露给 UI"
);
assert.equal(
  verifyBeforeSend.uiEvents.some(
    (event) => event.delta === "定制商品进入生产后不支持退款。[片段B]"
  ),
  true,
  "有来源支持的结论应保留并附上引用"
);

console.log("\n自检通过：分块核验的发送顺序符合预期。");
