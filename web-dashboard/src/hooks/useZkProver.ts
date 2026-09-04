"use client";

import { BrowserProvider } from "ethers";

export type ZkProof = { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] };

export function useZkProver() {
  const createCapacityProof = async (): Promise<ZkProof> => ({
    a: ["0", "0"], b: [["0", "0"], ["0", "0"]], c: ["0", "0"],
  });
  const signAvailability = async (request: { hospitalAddress: string; resourceCode: number; nonce: number }) => {
    if (!process.env.NEXT_PUBLIC_GOLDEN_LOCK_ADDRESS) throw new Error("NEXT_PUBLIC_GOLDEN_LOCK_ADDRESS is required");
    const ethereum = (window as Window & { ethereum?: unknown }).ethereum;
    if (!ethereum) throw new Error("A wallet is required for hospital proof signing");
    const provider = new BrowserProvider(ethereum as never);
    const signer = await provider.getSigner();
    const signerAddress = await signer.getAddress();
    if (signerAddress.toLowerCase() !== request.hospitalAddress.toLowerCase()) {
      throw new Error("Connected wallet does not match the registered hospital");
    }
    const network = await provider.getNetwork();
    return signer.signTypedData(
      {
        name: "GoldenLock",
        version: "1",
        chainId: network.chainId,
        verifyingContract: process.env.NEXT_PUBLIC_GOLDEN_LOCK_ADDRESS,
      },
      {
        Availability: [
          { name: "hospital", type: "address" },
          { name: "resourceCode", type: "uint256" },
          { name: "isAvailable", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { hospital: request.hospitalAddress, resourceCode: request.resourceCode, isAvailable: 1, nonce: request.nonce }
    );
  };

  return { createCapacityProof, signAvailability };
}