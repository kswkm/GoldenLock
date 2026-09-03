import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const { PRIVATE_KEY, SEPOLIA_RPC_URL, POLYGON_AMOY_RPC_URL, ETHERSCAN_API_KEY } = process.env;

const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      // 로컬 테스트: 구급차/병원/relayer 역할극을 위해 기본 계정 다수 사용
    },
    sepolia: {
      url: SEPOLIA_RPC_URL || "",
      accounts,
    },
    polygonAmoy: {
      url: POLYGON_AMOY_RPC_URL || "",
      accounts,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || "",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    artifacts: "./artifacts",
  },
};

export default config;
