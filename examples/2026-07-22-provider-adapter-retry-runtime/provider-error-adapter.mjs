import { TransientToolError } from "./runtime.mjs";

export class ToolAuthorizationError extends Error {}
export class UnknownProviderError extends Error {}

/**
 * Example HTTP-provider normalization. A different provider can supply its own
 * normalizer without changing the Runtime retry loop.
 */
export function normalizeHttpProviderError(rawError) {
  const status = rawError?.status;
  const code = rawError?.code;

  if (status === 429 || code === "ETIMEDOUT") {
    return new TransientToolError("TRANSIENT_PROVIDER_FAILURE", {
      cause: rawError,
    });
  }

  if (status === 401 || status === 403) {
    return new ToolAuthorizationError("PROVIDER_AUTHORIZATION_FAILED", {
      cause: rawError,
    });
  }

  return new UnknownProviderError("UNKNOWN_PROVIDER_FAILURE", {
    cause: rawError,
  });
}

/**
 * Keep provider-specific failures outside the Runtime's stable error contract.
 */
export function createReadFileAdapter({ providerReadFile, normalizeError }) {
  return async function readFile(path) {
    try {
      return await providerReadFile(path);
    } catch (rawError) {
      throw normalizeError(rawError);
    }
  };
}
