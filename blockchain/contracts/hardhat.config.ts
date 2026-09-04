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

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthersPlugin, hardhatIgnitionPlugin],
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks,
};

export default config;
