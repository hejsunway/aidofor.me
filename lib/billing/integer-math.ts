export function asSafeBigInt(value: unknown, label: string): bigint {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  throw new Error(`${label} is not a non-negative safe integer.`);
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < BigInt(0) || denominator <= BigInt(0)) throw new Error("Invalid integer division.");
  return (numerator + denominator - BigInt(1)) / denominator;
}

export function toSafeNumber(value: bigint, label: string): number {
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the server's safe integer boundary.`);
  }
  return Number(value);
}
