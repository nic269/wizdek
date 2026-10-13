const RETRYABLE_PRISMA_CODES: Readonly<Record<string, true>> = {
  P2034: true,
};
const MAX_DEPTH = 8;
const MAX_VISITED = 32;

const isObject = (value: unknown): value is Record<PropertyKey, unknown> =>
  (typeof value === "object" && value !== null) || typeof value === "function";

const readProperty = (
  value: Record<PropertyKey, unknown>,
  key: PropertyKey
) => {
  try {
    return value[key];
  } catch {
    // Error-like wrappers may expose throwing getters; ignore that metadata.
  }
};

const hasRetryableMarker = (value: Record<PropertyKey, unknown>) => {
  const code = readProperty(value, "code");
  if (typeof code === "string" && RETRYABLE_PRISMA_CODES[code] === true) {
    return true;
  }

  const originalCode = readProperty(value, "originalCode");
  const kind = readProperty(value, "kind");
  const isSerializationConflict =
    originalCode === "40001" && kind === "TransactionWriteConflict";
  const isDeadlock =
    code === "40P01" && originalCode === "40P01" && kind === "postgres";

  return isSerializationConflict || isDeadlock;
};

interface ConflictCandidate {
  depth: number;
  value: Record<PropertyKey, unknown>;
}

const nestedCandidates = (current: ConflictCandidate): ConflictCandidate[] => {
  const candidates: ConflictCandidate[] = [];
  const cause = readProperty(current.value, "cause");
  if (isObject(cause)) {
    candidates.push({ depth: current.depth + 1, value: cause });
  }

  const meta = readProperty(current.value, "meta");
  if (isObject(meta)) {
    const driverAdapterError = readProperty(meta, "driverAdapterError");
    if (isObject(driverAdapterError)) {
      candidates.push({
        depth: current.depth + 1,
        value: driverAdapterError,
      });
    }
  }

  return candidates;
};

export const isRetryableTransactionConflict = (error: unknown): boolean => {
  if (!isObject(error)) {
    return false;
  }

  const visited = new Set<object>();
  const queue: ConflictCandidate[] = [{ depth: 0, value: error }];

  while (queue.length > 0 && visited.size < MAX_VISITED) {
    const current = queue.shift();
    if (!current || visited.has(current.value)) {
      continue;
    }
    visited.add(current.value);

    if (hasRetryableMarker(current.value)) {
      return true;
    }
    if (current.depth >= MAX_DEPTH) {
      continue;
    }

    queue.push(...nestedCandidates(current));
  }

  return false;
};
