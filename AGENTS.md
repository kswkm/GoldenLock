# Hardhat + ethers project

## Project layout

```
contracts/        Solidity source files (*.sol) and unit tests (*.t.sol)
test/             TypeScript integration tests and Solidity unit tests (*.sol)
scripts/          Standalone scripts run with `hardhat run`
hardhat.config.ts
```

When writing or modifying contracts, deployment scripts, or tests, use the canonical `contracts/` project and run its compile/test commands before finishing.
