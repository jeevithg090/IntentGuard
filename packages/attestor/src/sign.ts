import { Address, createPublicClient, http, keccak256, toHex, encodeAbiParameters, PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Attestation, RiskTier } from "@intentguard/core";

export interface OrderData {
  user: Address;
  inputToken: Address;
  inputAmount: bigint;
  minOutput: bigint;
  destinationChainId: bigint;
  settler: Address;
  recipient: Address;
  destinationData: `0x${string}`;
}

export interface OnchainOrder {
  fillDeadline: number;
  orderDataType: `0x${string}`;
  orderData: `0x${string}`;
}

export function encodeOrderData(data: OrderData): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "bytes" },
    ],
    [
      data.user,
      data.inputToken,
      data.inputAmount,
      data.minOutput,
      data.destinationChainId,
      data.settler,
      data.recipient,
      data.destinationData,
    ],
  );
}

/**
 * ABI-encode the order exactly as Solidity's `abi.encode(order)` does for the
 * `OnchainCrossChainOrder` struct: a single tuple. Because the struct has a
 * dynamic member (`bytes orderData`), the encoding starts with a 0x20 offset
 * word — encoding the three fields as separate parameters would yield a
 * different hash and the vault would revert `AttestationOrderMismatch`.
 */
export function encodeOrder(order: OnchainOrder): `0x${string}` {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "fillDeadline", type: "uint32" },
          { name: "orderDataType", type: "bytes32" },
          { name: "orderData", type: "bytes" },
        ],
      },
    ],
    [order],
  );
}

export function orderIdOf(order: OnchainOrder): `0x${string}` {
  return keccak256(encodeOrder(order));
}

export const ATTESTATION_TYPEHASH = keccak256(
  toHex("RiskAttestation(bytes32 orderId,uint8 riskTier,uint16 feeBps,bytes32 simHash,uint64 expiry,uint64 nonce)"),
);

export function attestationHash(
  domainSeparator: `0x${string}`,
  att: {
    orderId: `0x${string}`;
    riskTier: number;
    feeBps: number;
    simHash: `0x${string}`;
    expiry: bigint;
    nonce: bigint;
  },
): `0x${string}` {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint16" },
        { type: "bytes32" },
        { type: "uint64" },
        { type: "uint64" },
      ],
      [att.orderId, att.riskTier, att.feeBps, att.simHash, att.expiry, att.nonce],
    ),
  );
  // keccak256(0x19 || 0x01 || domainSeparator || structHash)
  return keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}` as `0x${string}`);
}

export interface AttestationInput {
  orderId: `0x${string}`;
  riskTier: RiskTier;
  feeBps: number;
  simHash: `0x${string}`;
  expiry: number; // unix seconds
  nonce: bigint;
}

export async function signAttestation(
  account: PrivateKeyAccount,
  vaultAddress: Address,
  rpcUrl: string,
  input: AttestationInput,
): Promise<Attestation> {
  const publicClient = createPublicClient({ transport: http(rpcUrl) });

  const signature = await account.signTypedData({
    domain: {
      name: "IntentGuard PolicyVault",
      version: "1",
      chainId: await publicClient.getChainId(),
      verifyingContract: vaultAddress,
    },
    types: {
      RiskAttestation: [
        { name: "orderId", type: "bytes32" },
        { name: "riskTier", type: "uint8" },
        { name: "feeBps", type: "uint16" },
        { name: "simHash", type: "bytes32" },
        { name: "expiry", type: "uint64" },
        { name: "nonce", type: "uint64" },
      ],
    },
    primaryType: "RiskAttestation",
    message: {
      orderId: input.orderId,
      riskTier: input.riskTier,
      feeBps: input.feeBps,
      simHash: input.simHash,
      expiry: BigInt(input.expiry),
      nonce: input.nonce,
    },
  });

  return {
    orderId: input.orderId,
    riskTier: input.riskTier,
    feeBps: input.feeBps,
    simHash: input.simHash,
    expiry: input.expiry,
    nonce: input.nonce,
    signature,
  };
}

export function attestorAccount(privateKey: `0x${string}`): PrivateKeyAccount {
  return privateKeyToAccount(privateKey);
}
