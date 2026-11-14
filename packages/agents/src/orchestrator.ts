import {
  SolverQuote,
  Policy,
  Verdict,
  InjectionAttempt,
  ProposerOutput,
  RedTeamOutput,
  ArbiterOutput,
} from "@intentguard/core";
import { ModelClient } from "./model.js";
import { runProposer } from "./proposer.js";
import { runRedTeam } from "./redteam.js";
import { runArbiter } from "./arbiter.js";
import { untrustedDataBlock, screenQuote } from "./sanitize.js";

export interface ReviewResult {
  proposer: ProposerOutput;
  redTeam: RedTeamOutput;
  arbiter: ArbiterOutput;
  verdict: Verdict;
  selectedQuote: SolverQuote | null;
  localOverrideApplied: boolean;
  injectionAttempts: InjectionAttempt[];
}

function renderPolicy(policy: Policy): string {
  return JSON.stringify(
    {
      maxRiskTier: policy.maxRiskTier,
      maxFeeBps: policy.maxFeeBps,
      maxNotionalPerTx: policy.maxNotionalPerTx.toString(),
      dailyBudget: policy.dailyBudget.toString(),
      minFillDeadline: policy.minFillDeadline,
      expiry: policy.expiry,
    },
    null,
    2,
  );
}

function renderQuotes(quotes: SolverQuote[]): string {
  return quotes
    .map((q) => {
      const screened = screenQuote({
        solverName: q.solverName,
        tokenSymbol: q.tokenSymbol,
        protocolDescription: q.protocolDescription,
        annotations: q.annotations,
      });
      const flagged =
        screened.solverName.suspicious ||
        screened.tokenSymbol.suspicious ||
        screened.protocolDescription.suspicious ||
        screened.annotations.suspicious;
      return JSON.stringify(
        {
          id: q.id,
          solverId: q.solverId,
          solverName: screened.solverName.clean,
          tokenSymbol: screened.tokenSymbol.clean,
          protocolDescription: screened.protocolDescription.clean,
          annotations: screened.annotations.clean,
          destinationChainId: q.destinationChainId,
          inputAmountUsd: q.inputAmountUsd,
          expectedOutputUsd: q.expectedOutputUsd,
          executionSeconds: q.executionSeconds,
          feeBps: q.feeBps,
          quotedSlippageBps: q.quotedSlippageBps,
          riskTier: q.profile.tier,
          screenedFieldsFlagged: flagged,
        },
        null,
        2,
      );
    })
    .join("\n\n");
}

function renderProfiles(quotes: SolverQuote[]): string {
  return quotes
    .map(
      (q) =>
        `SETTLER ${q.settler} (solver ${q.id}): tier ${q.profile.tier}\n` +
        q.profile.signals
          .map((s) => `  - ${s.id} [${s.ok ? "ok" : "FAILED"}] tier ${s.tierContribution}: ${s.source.detail}`)
          .join("\n"),
    )
    .join("\n\n");
}

/**
 * Sequence the three roles, then apply the belt-and-braces local policy check:
 * if the Arbiter returns EXECUTE on a route whose computed tier exceeds the
 * policy, override to REFUSE. The vault would catch it anyway — this makes the
 * disagreement legible in the journal.
 */
export async function runAdversarialReview(
  model: ModelClient,
  input: { quotes: SolverQuote[]; policy: Policy },
): Promise<ReviewResult> {
  const untrustedBlock = untrustedDataBlock({
    solverName: input.quotes.map((q) => q.solverName).join(" | "),
    tokenSymbol: input.quotes.map((q) => q.tokenSymbol).join(" | "),
    protocolDescription: input.quotes.map((q) => q.protocolDescription).join(" | "),
    annotations: input.quotes.map((q) => q.annotations).join(" | "),
  });

  const quotesText = renderQuotes(input.quotes);
  const profilesText = renderProfiles(input.quotes);
  const policyText = renderPolicy(input.policy);

  const proposer = await runProposer(model, { quotes: quotesText, profiles: profilesText, policy: policyText });
  const redTeam = await runRedTeam(model, {
    proposerArgument: proposer.argument,
    untrustedBlock,
    quotes: quotesText,
    profiles: profilesText,
    policy: policyText,
  });
  const arbiter = await runArbiter(model, {
    proposerArgument: proposer.argument,
    redTeamCase: JSON.stringify(redTeam, null, 2),
    untrustedBlock,
    policy: policyText,
  });

  // Injection attempts from both the deterministic screener and the model.
  const injectionAttempts: InjectionAttempt[] = [];
  for (const q of input.quotes) {
    const s = screenQuote({
      solverName: q.solverName,
      tokenSymbol: q.tokenSymbol,
      protocolDescription: q.protocolDescription,
      annotations: q.annotations,
    });
    for (const [field, result] of Object.entries(s)) {
      if (result.suspicious) injectionAttempts.push({ field, quotedText: result.clean });
    }
  }
  for (const attempt of redTeam.injectionAttemptsDetected) injectionAttempts.push(attempt);

  const selectedQuote = input.quotes.find((q) => q.id === arbiter.selectedSolverId) ?? null;

  // Belt-and-braces: the model's EXECUTE never beats the computed tier.
  let verdict = arbiter.verdict;
  let localOverrideApplied = false;
  if (verdict === "EXECUTE") {
    if (!selectedQuote) {
      verdict = "REFUSE";
      localOverrideApplied = true;
    } else if (selectedQuote.profile.tier > input.policy.maxRiskTier) {
      verdict = "REFUSE";
      localOverrideApplied = true;
    } else if (selectedQuote.feeBps > input.policy.maxFeeBps) {
      verdict = "REFUSE";
      localOverrideApplied = true;
    } else if (BigInt(Math.floor(selectedQuote.inputAmountUsd * 1e6)) > input.policy.maxNotionalPerTx) {
      verdict = "REFUSE";
      localOverrideApplied = true;
    }
  }

  return {
    proposer,
    redTeam,
    arbiter,
    verdict,
    selectedQuote,
    localOverrideApplied,
    injectionAttempts,
  };
}
