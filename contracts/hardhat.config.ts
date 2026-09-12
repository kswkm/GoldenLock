import { defineConfig } from "hardhat/config";
import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatIgnitionPlugin from "@nomicfoundation/hardhat-ignition";
import * as dotenv from "dotenv";

dotenv.config();

const networks: HardhatUserConfig["networks"] = {
  hardhatMainnet: {
    type: "edr-simulated",
    chainType: "l1",
  },
};

if (process.env.POLYGON_AMOY_RPC_URL) {
  networks.polygonAmoy = {
    type: "http",
    chainType: "l1",
    url: process.env.POLYGON_AMOY_RPC_URL,
    accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
  };
}

if (process.env.ARBITRUM_SEPOLIA_RPC_URL) {
  networks.arbitrumSepolia = {
    type: "http",
    chainType: "l1",
    url: process.env.ARBITRUM_SEPOLIA_RPC_URL,
    accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
  };
}

// GoldenLock.sol이 실제로 요구하는 solc 설정. default/production 두 빌드 프로파일에
// 동일하게 명시해야 한다 — Hardhat 3는 `solidity.profiles`가 없을 때(또는 `production`
// 프로파일을 직접 정의하지 않았을 때) production 프로파일을 "default에서 version/type/path만
// 복사하고 settings는 버리는" 방식으로 자동 생성한다. `hardhat ignition deploy`는 내부적으로
// 이 production 프로파일을 강제로 쓰므로, settings를 여기 명시하지 않으면 아래 두 옵션이
// 조용히 사라진 채로 컴파일되어 실패한다.
const solidityCompilerSettings = {
  optimizer: { enabled: true, runs: 200 },
  // @openzeppelin/contracts(^5.0.2가 실제로는 최신 5.x로 설치됨)의 utils/Bytes.sol이
  // mcopy() 어셈블리 명령을 쓴다. solc 0.8.24는 mcopy를 지원은 하지만 cancun이
  // 기본 evmVersion은 아니어서(기본값이 된 건 0.8.25부터), 명시적으로 지정하지
  // 않으면 "Function \"mcopy\" not found"로 컴파일이 실패한다.
  evmVersion: "cancun" as const,
  // GoldenLock.sol::requestAndLock/_verifyAndConsumeNonce는 파라미터+지역변수가 많아
  // (hospital, ambulanceOperator, ktasLevel, requestHash, a, b, c, publicSignals,
  // ambulanceSignature, structHash, verifier, proofValid, requestId ...) 레거시
  // codegen의 EVM 스택 16슬롯 한도를 넘는다("Stack too deep"). viaIR 파이프라인은
  // 이 제약이 없는 방식으로 컴파일하므로 옵티마이저와 함께 활성화한다.
  viaIR: true,
};

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin, hardhatIgnitionPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.24",
        settings: solidityCompilerSettings,
      },
      production: {
        version: "0.8.24",
        settings: solidityCompilerSettings,
      },
    },
  },
  networks,
});
