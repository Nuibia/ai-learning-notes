export function createTenantStore() {
  const records = new Map();

  function requireIdentity(tenantId, conversationId) {
    if (!tenantId || !conversationId) {
      throw new Error("tenantId and conversationId are required");
    }
  }

  function keyFor(tenantId, conversationId) {
    return JSON.stringify([tenantId, conversationId]);
  }

  function write({ tenantId, conversationId, value }) {
    requireIdentity(tenantId, conversationId);
    records.set(keyFor(tenantId, conversationId), structuredClone(value));
  }

  function read({ tenantId, conversationId }) {
    requireIdentity(tenantId, conversationId);
    const value = records.get(keyFor(tenantId, conversationId));
    return value === undefined ? null : structuredClone(value);
  }

  return { read, write };
}
