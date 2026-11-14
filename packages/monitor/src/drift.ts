import { Position, RiskProfile, DriftEvent, Signal } from "@intentguard/core";

export type ScoreFn = (position: Position) => Promise<RiskProfile>;

export interface ScanResult {
  driftEvents: DriftEvent[];
  escalations: Position[];
  errors: string[];
}

/**
 * Re-score every open position with the same oracle used at execution time,
 * and emit DriftDetected when the computed tier exceeds the tier at open.
 * A transient scoring failure never escalates — that's how a monitor avoids
 * pausing the treasury over an RPC hiccup.
 */
export async function scanPositions(positions: Position[], score: ScoreFn): Promise<ScanResult> {
  const driftEvents: DriftEvent[] = [];
  const escalations: Position[] = [];
  const errors: string[] = [];

  for (const pos of positions) {
    try {
      const now = await score(pos);
      if (now.tier > pos.tierAtOpen) {
        driftEvents.push({
          positionId: pos.id,
          from: pos.tierAtOpen,
          to: now.tier,
          cause: diffSignals(pos.signalsAtOpen, now.signals),
          escalated: now.tier > pos.policySnapshot.maxRiskTier,
          detectedAt: Date.now(),
        });
        if (now.tier > pos.policySnapshot.maxRiskTier) escalations.push(pos);
      }
    } catch (e) {
      errors.push(`position ${pos.id}: ${(e as Error).message}`);
    }
  }

  return { driftEvents, escalations, errors };
}

/** Human-readable before/after for each changed signal. */
export function diffSignals(before: Signal[], after: Signal[]): string {
  const changes: string[] = [];
  for (const afterSignal of after) {
    const beforeSignal = before.find((s) => s.id === afterSignal.id);
    if (!beforeSignal) {
      changes.push(`${afterSignal.id} appeared (tier ${afterSignal.tierContribution})`);
      continue;
    }
    if (beforeSignal.tierContribution !== afterSignal.tierContribution) {
      changes.push(
        `${afterSignal.id}: tier ${beforeSignal.tierContribution} → ${afterSignal.tierContribution} (was "${beforeSignal.source.detail}", now "${afterSignal.source.detail}")`,
      );
    }
  }
  return changes.length > 0 ? changes.join("; ") : "no individual signal changed";
}
