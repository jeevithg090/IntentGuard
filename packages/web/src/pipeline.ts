// The stages of one IntentGuard decision, in order. Used by the Mandate view's
// progress stepper and by Demo Mode's staged run.
export const PIPELINE_STEPS: string[] = [
  "Parsing mandate → structured constraints…",
  "Scoring 3 routes from live chain state…",
  "Proposer vs Red Team — adversarial review…",
  "Screening solver metadata for prompt injection…",
  "Simulating the winning route against forked state…",
  "Requesting on-chain risk attestation…",
];
