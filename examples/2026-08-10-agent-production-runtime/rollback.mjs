export function shouldRollback(
  { healthOk, errorRate },
  { maxErrorRate }
) {
  // 学习者补全：候选版本不健康，或错误率超过阈值时回滚。
  return !healthOk || errorRate > maxErrorRate;
}

export function evaluateRelease({ stableVersion, candidateVersion, signals, policy }) {
  if (shouldRollback(signals, policy)) {
    return {
      action: "rollback",
      activeVersion: stableVersion,
      rejectedVersion: candidateVersion
    };
  }

  return {
    action: "keep_candidate",
    activeVersion: candidateVersion
  };
}
