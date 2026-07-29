function clone(value) {
  return structuredClone(value);
}

export function parseMarkdown({ source, text }) {
  const parsed = {
    source,
    title: "",
    sections: []
  };
  let currentSection = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading?.[1].length === 1) {
      parsed.title = heading[2];
      continue;
    }
    if (heading) {
      currentSection = {
        heading: heading[2],
        paragraphs: []
      };
      parsed.sections.push(currentSection);
      continue;
    }

    if (currentSection) {
      currentSection.paragraphs.push(line);
    }
  }

  return parsed;
}

export function chunkMarkdownBySection(parsedDocument) {
  return parsedDocument.sections.map((section, chunkIndex) => ({
    id: `${parsedDocument.source}#${chunkIndex}`,
    text: `${section.heading}\n${section.paragraphs.join("\n")}`,
    metadata: {
      source: parsedDocument.source,
      documentTitle: parsedDocument.title,
      section: section.heading,
      chunkIndex
    }
  }));
}

function splitWithOverlap(text, maxChars, overlapChars) {
  if (text.length <= maxChars) return [text];
  if (maxChars <= 0 || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error("切分参数无效：需要 0 <= overlapChars < maxChars");
  }

  const parts = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    parts.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlapChars;
  }
  return parts;
}

function splitIntoNaturalUnits(paragraphs) {
  return paragraphs.flatMap(
    (paragraph) =>
      paragraph.match(/[^。！？!?]+[。！？!?]?/g)?.filter(Boolean) ?? []
  );
}

function packNaturalUnits(paragraphs, maxChars, overlapChars) {
  const parts = [];
  let current = "";

  for (const unit of splitIntoNaturalUnits(paragraphs)) {
    if (unit.length > maxChars) {
      if (current) {
        parts.push(current);
        current = "";
      }
      parts.push(...splitWithOverlap(unit, maxChars, overlapChars));
      continue;
    }

    const combined = current ? `${current}\n${unit}` : unit;
    if (combined.length <= maxChars) {
      current = combined;
      continue;
    }

    parts.push(current);
    current = unit;
  }

  if (current) parts.push(current);
  return parts;
}

export function chunkMarkdownForIndex(
  parsedDocument,
  {
    documentId,
    indexVersion,
    maxChars = 500,
    overlapChars = 50
  }
) {
  let chunkIndex = 0;

  return parsedDocument.sections.flatMap((section, sectionIndex) => {
    const bodyLimit = Math.max(1, maxChars - section.heading.length - 1);
    const parts = packNaturalUnits(
      section.paragraphs,
      bodyLimit,
      overlapChars
    );
    const parentChunkId = `${documentId}:${sectionIndex}`;

    return parts.map((part, partIndex) => {
      const currentChunkIndex = chunkIndex++;
      return {
        id: `${documentId}:${indexVersion}:${currentChunkIndex}`,
        text: `${section.heading}\n${part}`,
        metadata: {
          source: parsedDocument.source,
          documentId,
          documentTitle: parsedDocument.title,
          section: section.heading,
          sectionIndex,
          partIndex,
          chunkIndex: currentChunkIndex,
          parentChunkId,
          indexVersion
        }
      };
    });
  });
}

function magnitude(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

export function cosineDistance(left, right) {
  if (left.length !== right.length) {
    throw new Error(`向量维度不一致：${left.length} !== ${right.length}`);
  }

  const denominator = magnitude(left) * magnitude(right);
  if (denominator === 0) return 1;

  const dotProduct = left.reduce(
    (sum, value, index) => sum + value * right[index],
    0
  );
  return 1 - dotProduct / denominator;
}

/**
 * 教学用 Embedding Stub。
 *
 * 它用人工规则把近义词映射到相同维度，只用于让 Demo 可重复运行；
 * 真实项目应替换成正式 Embedding 模型，不能把这段规则当成语义模型。
 */
export class EmbeddingStub {
  constructor(modelId = "embedding-stub-v1") {
    this.modelId = modelId;
  }

  embed(text) {
    const groups = [
      ["退款", "退钱", "退货", "退款期"],
      ["定制", "定做", "专属商品"],
      ["权限", "授权", "认证", "403", "ERR_AUTH_403"],
      ["流式", "SSE", "首字", "逐字"],
      ["检索", "向量", "RAG", "Embedding"]
    ];

    return groups.map((terms) =>
      terms.some((term) => text.includes(term)) ? 1 : 0
    );
  }
}

export class InMemoryVectorStore {
  #rows = [];
  #activeIndexVersion = null;

  addDocuments(documents, embeddingModel) {
    for (const document of documents) {
      this.#rows.push({
        ...clone(document),
        embeddingModel: embeddingModel.modelId,
        vector: embeddingModel.embed(document.text)
      });
    }
  }

  setActiveIndexVersion(indexVersion) {
    this.#activeIndexVersion = indexVersion;
  }

  deleteDocumentVersion({ documentId, indexVersion }) {
    const before = this.#rows.length;
    this.#rows = this.#rows.filter(
      (row) =>
        row.metadata?.documentId !== documentId ||
        row.metadata?.indexVersion !== indexVersion
    );
    return before - this.#rows.length;
  }

  countDocumentVersion({ documentId, indexVersion }) {
    return this.#rows.filter(
      (row) =>
        row.metadata?.documentId === documentId &&
        row.metadata?.indexVersion === indexVersion
    ).length;
  }

  search({ queryVector, queryEmbeddingModel, limit }) {
    const searchableRows = this.#activeIndexVersion
      ? this.#rows.filter(
          (row) => row.metadata?.indexVersion === this.#activeIndexVersion
        )
      : this.#rows;

    for (const row of searchableRows) {
      if (row.embeddingModel !== queryEmbeddingModel) {
        throw new Error(
          `Embedding 模型不一致：索引=${row.embeddingModel}，查询=${queryEmbeddingModel}`
        );
      }
    }

    return searchableRows
      .map((row) => ({
        id: row.id,
        text: row.text,
        metadata: clone(row.metadata ?? {}),
        distance: cosineDistance(queryVector, row.vector)
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, limit);
  }
}

function exactIdentifiers(text) {
  return text.match(/[A-Z][A-Z0-9_]{2,}/g) ?? [];
}

export function keywordSearch(documents, query, limit) {
  const identifiers = exactIdentifiers(query);
  return documents
    .map((document) => ({
      ...clone(document),
      matchedIdentifiers: identifiers.filter((identifier) =>
        document.text.includes(identifier)
      )
    }))
    .filter((document) => document.matchedIdentifiers.length > 0)
    .sort(
      (left, right) =>
        right.matchedIdentifiers.length - left.matchedIdentifiers.length
    )
    .slice(0, limit);
}

export function selectByDistance(hits, limit, direction = "nearest") {
  const sorted = clone(hits).sort((left, right) =>
    direction === "nearest"
      ? left.distance - right.distance
      : right.distance - left.distance
  );
  return sorted.slice(0, limit);
}

export class RagRuntime {
  #documents;
  #embeddingModel;
  #vectorStore;
  #generate;

  constructor({
    documents,
    embeddingModel = new EmbeddingStub(),
    vectorStore = new InMemoryVectorStore(),
    generate = ({ question, context }) => ({ question, context })
  }) {
    this.#documents = clone(documents);
    this.#embeddingModel = embeddingModel;
    this.#vectorStore = vectorStore;
    this.#generate = generate;
    this.#vectorStore.addDocuments(this.#documents, this.#embeddingModel);
  }

  retrieve(query, { candidateK = 3, finalK = 2 } = {}) {
    const keywordHits = keywordSearch(this.#documents, query, candidateK);
    const semanticHits = this.#vectorStore.search({
      queryVector: this.#embeddingModel.embed(query),
      queryEmbeddingModel: this.#embeddingModel.modelId,
      limit: candidateK
    });

    const merged = new Map();
    for (const hit of semanticHits) {
      merged.set(hit.id, {
        id: hit.id,
        text: hit.text,
        metadata: clone(hit.metadata ?? {}),
        distance: hit.distance,
        exactMatch: false
      });
    }
    for (const hit of keywordHits) {
      const existing = merged.get(hit.id);
      merged.set(hit.id, {
        id: hit.id,
        text: hit.text,
        metadata: clone(hit.metadata ?? existing?.metadata ?? {}),
        distance: existing?.distance ?? 1,
        exactMatch: true
      });
    }

    const finalChunks = [...merged.values()]
      .sort(
        (left, right) =>
          Number(right.exactMatch) - Number(left.exactMatch) ||
          left.distance - right.distance
      )
      .slice(0, finalK);

    return {
      candidateK,
      finalK,
      keywordHits,
      semanticHits,
      finalChunks
    };
  }

  fileSearch(query, options) {
    return this.retrieve(query, options).finalChunks;
  }

  answer(query, options) {
    const retrieval = this.retrieve(query, options);
    return {
      retrieval,
      generated: this.#generate({
        question: query,
        context: retrieval.finalChunks.map((chunk) => chunk.text)
      })
    };
  }
}
