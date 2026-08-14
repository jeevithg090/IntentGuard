/** JSON.stringify with BigInt support (serialized as strings). */
export function jsonSafe(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    space,
  );
}

/** Deep-clone an object graph with BigInts converted to strings (JSON-safe). */
export function toJsonSafe<T>(value: T): unknown {
  return JSON.parse(jsonSafe(value));
}
