import { keccak256, stringToHex, encodeAbiParameters } from "viem";
import { SimulationAssertion, SimulationResult } from "@intentguard/core";

/**
 * Canonical simHash: keccak256 over the simulation's block number and every
 * assertion, with keys sorted for determinism. The vault commits this hash in
 * the attestation — tamper with any assertion and the hash changes.
 */
export function computeSimHash(blockNumber: bigint, assertions: SimulationAssertion[]): `0x${string}` {
  const sorted = [...assertions].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = {
    blockNumber: blockNumber.toString(),
    assertions: sorted.map((a) => ({ id: a.id, passed: a.passed, observed: a.observed })),
  };
  return keccak256(stringToHex(JSON.stringify(canonical)));
}

export function buildSimulationResult(blockNumber: bigint, assertions: SimulationAssertion[]): SimulationResult {
  return {
    blockNumber,
    assertions,
    simHash: computeSimHash(blockNumber, assertions),
  };
}

/** True iff every assertion passed. The gate: no attestation on a failed sim. */
export function allPassed(result: SimulationResult): boolean {
  return result.assertions.every((a) => a.passed);
}

export function failedAssertions(result: SimulationResult): SimulationAssertion[] {
  return result.assertions.filter((a) => !a.passed);
}
