import hre from "hardhat";
import { LIVE_ROLE_EXECUTION_DELAYS_SECONDS, ROLE_IDS } from "../config/marketConfig";
import { deployDualVmSystem, type DeployDualVmOverrides } from "./deploySystem";
import { waitForTransaction } from "../runtime/transactions";

const { ethers } = hre;

function selector(contract: { interface: { getFunction(name: string): { selector: string } | null } }, name: string) {
  const fragment = contract.interface.getFunction(name);
  if (!fragment) {
    throw new Error(`Missing function selector for ${name}`);
  }
  return fragment.selector;
}

export interface DeployGovernedOverrides extends DeployDualVmOverrides {
  /** Initial supply of governance tokens (WAD-denominated) */
  governanceTokenSupply: bigint;
  /** Voting delay in seconds (timestamp-based) */
  votingDelaySeconds: number;
  /** Voting period in seconds */
  votingPeriodSeconds: number;
  /** Timelock minimum delay in seconds */
  timelockMinDelaySeconds: number;
  /** Quorum numerator (e.g. 4 for 4%) */
  quorumNumerator: number;
}

export async function deployGovernedSystem(overrides: DeployGovernedOverrides) {
  // ── Bootstrap-then-transfer pattern ──
  // We first deploy the full DualVM system via `deployDualVmSystem()` using the deployer EOA
  // as the initial admin/owner. This is intentional: the Governor and TimelockController
  // cannot exist yet at this stage, so the deployer must temporarily hold admin power.
  // After the Governor stack is deployed below, we transfer AccessManager admin to the
  // TimelockController, grant the Governor PROPOSER/CANCELLER roles on the timelock,
  // and revoke all deployer admin privileges — completing the handoff to on-chain governance.

  // Governed deployments default to LIVE execution delays (non-zero for sensitive roles)
  const governedOverrides: DeployGovernedOverrides = {
    ...overrides,
    emergencyExecutionDelaySeconds:
      overrides.emergencyExecutionDelaySeconds ?? LIVE_ROLE_EXECUTION_DELAYS_SECONDS.emergency,
    riskAdminExecutionDelaySeconds:
      overrides.riskAdminExecutionDelaySeconds ?? LIVE_ROLE_EXECUTION_DELAYS_SECONDS.riskAdmin,
    treasuryExecutionDelaySeconds:
      overrides.treasuryExecutionDelaySeconds ?? LIVE_ROLE_EXECUTION_DELAYS_SECONDS.treasury,
    minterExecutionDelaySeconds:
      overrides.minterExecutionDelaySeconds ?? LIVE_ROLE_EXECUTION_DELAYS_SECONDS.minter,
  };

  const base = await deployDualVmSystem(governedOverrides);
  const { accessManager, marketRegistry } = base.contracts as any;
  const deployer = base.deployer;

  // Deploy GovernanceToken
  const governanceTokenFactory = await ethers.getContractFactory("GovernanceToken", deployer);
  const governanceToken = await governanceTokenFactory.deploy(
    await accessManager.getAddress(),
    await deployer.getAddress(),
    overrides.governanceTokenSupply,
  );
  await governanceToken.waitForDeployment();

  // Deploy TimelockController (Governor will be proposer/canceller, anyone can execute)
  const timelockFactory = await ethers.getContractFactory("TimelockController", deployer);
  const timelock = await timelockFactory.deploy(
    overrides.timelockMinDelaySeconds,
    [], // proposers — will be set after governor deploy
    [ethers.ZeroAddress], // executors — open execution
    await deployer.getAddress(), // temporary admin for setup
  );
  await timelock.waitForDeployment();

  // Deploy DualVMGovernor
  const governorFactory = await ethers.getContractFactory("DualVMGovernor", deployer);
  const governor = await governorFactory.deploy(
    await governanceToken.getAddress(),
    await timelock.getAddress(),
    overrides.votingDelaySeconds,
    overrides.votingPeriodSeconds,
    overrides.quorumNumerator,
  );
  await governor.waitForDeployment();

  // Grant Governor the PROPOSER_ROLE and CANCELLER_ROLE on the timelock
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  await waitForTransaction(
    timelock.grantRole(PROPOSER_ROLE, await governor.getAddress()),
    "grant governor proposer role",
  );
  await waitForTransaction(
    timelock.grantRole(CANCELLER_ROLE, await governor.getAddress()),
    "grant governor canceller role",
  );

  // Renounce deployer's TIMELOCK_ADMIN_ROLE on the timelock
  const TIMELOCK_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();
  await waitForTransaction(
    timelock.renounceRole(TIMELOCK_ADMIN_ROLE, await deployer.getAddress()),
    "renounce timelock admin role",
  );

  // Wire governance role on MarketVersionRegistry through AccessManager
  await waitForTransaction(
    accessManager.setTargetFunctionRole(
      await marketRegistry.getAddress(),
      [selector(marketRegistry, "registerVersion"), selector(marketRegistry, "activateVersion")],
      ROLE_IDS.GOVERNANCE,
    ),
    "set registry governance role",
  );
  await waitForTransaction(
    accessManager.labelRole(ROLE_IDS.GOVERNANCE, "GOVERNANCE_ROLE"),
    "label governance role",
  );
  await waitForTransaction(
    accessManager.grantRole(ROLE_IDS.GOVERNANCE, await timelock.getAddress(), 0),
    "grant timelock governance role",
  );
  await waitForTransaction(
    accessManager.grantRole(0, await timelock.getAddress(), 0),
    "grant timelock admin role",
  );
  await waitForTransaction(accessManager.revokeRole(0, await deployer.getAddress()), "revoke deployer admin role");

  // Return corrected governance metadata: admin is now the timelock (not the deployer).
  // The base deployment's governance.admin still points to the deployer, so we override it
  // here to reflect the post-transfer state of the system.
  const timelockAddress = await timelock.getAddress();
  return {
    ...base,
    governance: {
      ...base.governance,
      admin: timelockAddress,
    },
    governanceRoot: {
      governanceToken,
      governor,
      timelock,
    },
  };
}
