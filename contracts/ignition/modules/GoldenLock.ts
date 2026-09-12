import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("GoldenLockModule", (m) => {
  const owner = m.getAccount(0);

  const verifier = m.contract("Verifier");
  const goldenLock = m.contract("GoldenLock", [owner]);

  m.call(goldenLock, "registerHospital", [owner, verifier, 10n]);

  return { verifier, goldenLock };
});
