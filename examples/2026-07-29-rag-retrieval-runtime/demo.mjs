import {
  EmbeddingStub,
  InMemoryVectorStore,
  RagRuntime,
  chunkMarkdownBySection,
  chunkMarkdownForIndex,
  parseMarkdown,
  selectByDistance
} from "./runtime.mjs";

const documents = [
  { id: "refund-general", text: "普通商品退款期限为付款后 30 天。" },
  { id: "refund-custom", text: "定制商品不支持退款。" },
  {
    id: "auth-403",
    text: "ERR_AUTH_403 表示当前用户没有访问权限，需要检查授权配置。"
  },
  { id: "streaming", text: "SSE 流式输出可以降低用户看到首字的延迟。" }
];

const runtime = new RagRuntime({
  documents,
  generate: ({ question, context }) => ({
    role: "assistant",
    note: "这里用 Stub 展示真正交给 LLM 的输入，不调用真实模型。",
    question,
    context
  })
});

const query = "接口提示 ERR_AUTH_403，应该怎么排查授权？";
const options = { candidateK: 3, finalK: 2 };

console.log("\n1. 普通文件搜索：只返回片段，不生成回答");
console.dir(runtime.fileSearch(query, options), { depth: null });

console.log("\n2. RAG：Runtime 把用户问题和最终片段一起交给 LLM Stub");
const ragResult = runtime.answer(query, options);
console.dir(ragResult.generated, { depth: null });

console.log("\n3. candidateK 与 finalK");
console.log({
  semanticCandidateCount: ragResult.retrieval.semanticHits.length,
  finalContextCount: ragResult.retrieval.finalChunks.length
});

console.log("\n4. distance 排序方向用反会选中更远的片段");
const hits = [
  { id: "A", distance: 0.12 },
  { id: "B", distance: 0.78 }
];
console.log({
  correct: selectByDistance(hits, 1, "nearest"),
  wrong: selectByDistance(hits, 1, "farthest")
});

console.log("\n5. 切换 Embedding 模型但不重建索引会被确定性阻断");
const store = new InMemoryVectorStore();
const modelA = new EmbeddingStub("embedding-a");
const modelB = new EmbeddingStub("embedding-b");
store.addDocuments(documents, modelA);

try {
  store.search({
    queryVector: modelB.embed(query),
    queryEmbeddingModel: modelB.modelId,
    limit: 2
  });
} catch (error) {
  console.log(error.message);
}

console.log("\n6. L15 第一步：Markdown 按标题解析并切成独立 Chunk");
const refundMarkdown = `# 退款规则

## 普通商品
普通商品退款期限为付款后 30 天。

## 定制商品
定制商品不支持退款。`;
const parsedRefundPolicy = parseMarkdown({
  source: "refund-policy.md",
  text: refundMarkdown
});
const refundChunks = chunkMarkdownBySection(parsedRefundPolicy);
console.dir(refundChunks, { depth: null });

const chunkRuntime = new RagRuntime({ documents: refundChunks });
console.log("\n7. 定制商品问题召回独立章节，并保留来源元数据");
console.dir(chunkRuntime.fileSearch("定做商品能退钱吗？", { finalK: 1 }), {
  depth: null
});

console.log("\n8. 超长章节优先按完整句子切分，异常长句才使用字符级 overlap");
const longPolicyMarkdown = `${refundMarkdown}

## 售后细则
规则一：退款申请需要提交订单号和付款凭证。
规则二：审核通过后，退款将在五个工作日内原路返回。
规则三：商品已经使用或损坏时，需要人工复核责任。
规则四：遇到系统异常时，请保留 ERR_AUTH_403 等错误信息。`;
const parsedLongPolicy = parseMarkdown({
  source: "refund-policy.md",
  text: longPolicyMarkdown
});
const v1Chunks = chunkMarkdownForIndex(parsedLongPolicy, {
  documentId: "doc-17",
  indexVersion: "v1",
  maxChars: 90,
  overlapChars: 15
});
const v2Chunks = chunkMarkdownForIndex(parsedLongPolicy, {
  documentId: "doc-17",
  indexVersion: "v2",
  maxChars: 65,
  overlapChars: 15
});
console.dir(
  v2Chunks.map(({ id, metadata, text }) => ({ id, metadata, text })),
  { depth: null }
);

console.log("\n9. 先验证 v2，再切换检索版本，最后清理 v1");
const versionedStore = new InMemoryVectorStore();
versionedStore.addDocuments(v1Chunks, modelA);
versionedStore.addDocuments(v2Chunks, modelA);
versionedStore.setActiveIndexVersion("v2");
const activeHits = versionedStore.search({
  queryVector: modelA.embed("系统异常和权限错误怎么办？"),
  queryEmbeddingModel: modelA.modelId,
  limit: 2
});
const removedV1Count = versionedStore.deleteDocumentVersion({
  documentId: "doc-17",
  indexVersion: "v1"
});
console.dir({
  activeHitVersions: activeHits.map((hit) => hit.metadata.indexVersion),
  removedV1Count,
  remainingV1Count: versionedStore.countDocumentVersion({
    documentId: "doc-17",
    indexVersion: "v1"
  }),
  remainingV2Count: versionedStore.countDocumentVersion({
    documentId: "doc-17",
    indexVersion: "v2"
  })
});
