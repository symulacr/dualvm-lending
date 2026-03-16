import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { deployGovernedSystem } from "../lib/deployment/deployGovernedSystem";
import { deployMarketVersion } from "../lib/deployment/deployMarketVersion";
import { WAD } from "../lib/config/marketConfig";

const VOTING_DELAY = 1; // 1 second
const VOTING_PERIOD = 300; // 5 minutes
const TIMELOCK_DELAY = 60; // 60 seconds
const QUORUM_NUMERATOR = 4; // 4%
const INITIAL_SUPPLY = 1_000_000n * WAD;

describe("Governor lifecycle", function () {
  async function deployFixture() {
    const [deployer, voter1, voter2, voter3, outsider] = await ethers.getSigners();

    const deployment = await deployGovernedSystem({
      governanceTokenSupply: INITIAL_SUPPLY,
      votingDelaySeconds: VOTING_DELAY,
      votingPeriodSeconds: VOTING_PERIOD,
      timelockMinDelaySeconds: TIMELOCK_DELAY,
      quorumNumerator: QUORUM_NUMERATOR,
    });

    const governanceToken = deployment.governanceRoot.governanceToken as any;
    const governor = deployment.governanceRoot.governor as any;
    const timelock = deployment.governanceRoot.timelock as any;
    const accessManager = deployment.contracts.accessManager as any;
    const marketRegistry = deployment.contracts.marketRegistry as any;

    // Distribute tokens: deployer keeps 60%, voter1 20%, voter2 15%, voter3 5%
    const voter1Amount = 200_000n * WAD;
    const voter2Amount = 150_000n * WAD;
    const voter3Amount = 50_000n * WAD;

    await governanceToken.transfer(voter1.address, voter1Amount);
    await governanceToken.transfer(voter2.address, voter2Amount);
    await governanceToken.transfer(voter3.address, voter3Amount);

    // Self-delegate to activate voting power
    await governanceToken.connect(deployer).delegate(deployer.address);
    await governanceToken.connect(voter1).delegate(voter1.address);
    await governanceToken.connect(voter2).delegate(voter2.address);
    await governanceToken.connect(voter3).delegate(voter3.address);

    return {
      deployer,
      voter1,
      voter2,
      voter3,
      outsider,
      deployment,
      governanceToken,
      governor,
      timelock,
      accessManager,
      marketRegistry,
      wpas: deployment.contracts.wpas as any,
      usdc: deployment.contracts.usdc as any,
    };
  }

  it("deploys governance token with correct supply and ERC20Votes", async function () {
    const { governanceToken, deployer, voter1, voter2, voter3 } = await loadFixture(deployFixture);

    expect(await governanceToken.totalSupply()).to.equal(INITIAL_SUPPLY);
    expect(await governanceToken.name()).to.equal("DualVM Governance");
    expect(await governanceToken.symbol()).to.equal("dvGOV");

    const deployerBalance = await governanceToken.balanceOf(deployer.address);
    const voter1Balance = await governanceToken.balanceOf(voter1.address);
    const voter2Balance = await governanceToken.balanceOf(voter2.address);
    const voter3Balance = await governanceToken.balanceOf(voter3.address);
    expect(deployerBalance + voter1Balance + voter2Balance + voter3Balance).to.equal(INITIAL_SUPPLY);
  });

  it("uses timestamp-based CLOCK_MODE", async function () {
    const { governanceToken } = await loadFixture(deployFixture);

    expect(await governanceToken.CLOCK_MODE()).to.equal("mode=timestamp");

    const clock = await governanceToken.clock();
    const latestBlock = await ethers.provider.getBlock("latest");
    expect(clock).to.be.closeTo(latestBlock!.timestamp, 5);
  });

  it("self-delegation activates voting power", async function () {
    const { governanceToken, voter1 } = await loadFixture(deployFixture);

    const voter1Balance = await governanceToken.balanceOf(voter1.address);
    const voter1Votes = await governanceToken.getVotes(voter1.address);
    expect(voter1Votes).to.equal(voter1Balance);
    expect(voter1Votes).to.be.gt(0n);
  });

  it("undelegated holder has zero voting power", async function () {
    const { governanceToken, outsider, deployer } = await loadFixture(deployFixture);

    // Transfer tokens to outsider but don't delegate
    await governanceToken.connect(deployer).transfer(outsider.address, 1_000n * WAD);
    expect(await governanceToken.balanceOf(outsider.address)).to.be.gt(0n);
    expect(await governanceToken.getVotes(outsider.address)).to.equal(0n);
  });

  it("full propose → vote → queue → execute lifecycle", async function () {
    const { deployer, voter1, voter2, governor, timelock, accessManager, marketRegistry, wpas, usdc } =
      await loadFixture(deployFixture);

    // Create a new market version to register and activate
    const temporaryVersion = await deployMarketVersion({
      deployer,
      authority: await accessManager.getAddress(),
      collateralAsset: await wpas.getAddress(),
      debtAsset: await usdc.getAddress(),
      autoWireLendingCore: false,
    });

    // Wire lending core to debt pool via timelock (timelock has admin role)
    const debtPoolAddress = await temporaryVersion.debtPool.getAddress();
    const wireData = temporaryVersion.debtPool.interface.encodeFunctionData("setLendingCore", [
      await temporaryVersion.lendingCore.getAddress(),
    ]);
    const wireTargets = [debtPoolAddress];
    const wireValues = [0n];
    const wireCalldatas = [wireData];
    const wireDescription = "Wire lending core to debt pool for v2";

    // Submit wire proposal
    const wireTx = await governor.connect(deployer).propose(wireTargets, wireValues, wireCalldatas, wireDescription);
    const wireReceipt = await wireTx.wait();
    const wirePropId = (wireReceipt!.logs.find((l: any) => l.fragment?.name === "ProposalCreated") as any)?.args?.[0]
      ?? await governor.hashProposal(wireTargets, wireValues, wireCalldatas, ethers.id(wireDescription));

    // Wait past voting delay
    await time.increase(VOTING_DELAY + 1);

    // Vote in favor
    await governor.connect(deployer).castVote(wirePropId, 1); // For
    await governor.connect(voter1).castVote(wirePropId, 1);

    // Wait for voting to end
    await time.increase(VOTING_PERIOD + 1);

    // Queue
    await governor.queue(wireTargets, wireValues, wireCalldatas, ethers.id(wireDescription));

    // Wait for timelock
    await time.increase(TIMELOCK_DELAY + 1);

    // Execute wire
    await governor.execute(wireTargets, wireValues, wireCalldatas, ethers.id(wireDescription));

    // Now propose register + activate version through governance
    const registryAddress = await marketRegistry.getAddress();
    const registerData = marketRegistry.interface.encodeFunctionData("registerVersion", [
      await temporaryVersion.lendingCore.getAddress(),
      await temporaryVersion.debtPool.getAddress(),
      await temporaryVersion.oracle.getAddress(),
      await temporaryVersion.riskEngine.getAddress(),
    ]);
    const activateData = marketRegistry.interface.encodeFunctionData("activateVersion", [2n]);

    const targets = [registryAddress, registryAddress];
    const values = [0n, 0n];
    const calldatas = [registerData, activateData];
    const description = "Register and activate market version 2";

    const proposalTx = await governor.connect(deployer).propose(targets, values, calldatas, description);
    const proposalReceipt = await proposalTx.wait();
    const proposalId = (proposalReceipt!.logs.find((l: any) => l.fragment?.name === "ProposalCreated") as any)?.args?.[0]
      ?? await governor.hashProposal(targets, values, calldatas, ethers.id(description));

    // State should be Pending (0)
    expect(await governor.state(proposalId)).to.equal(0);

    // Wait for voting delay to elapse
    await time.increase(VOTING_DELAY + 1);

    // State should be Active (1)
    expect(await governor.state(proposalId)).to.equal(1);

    // Vote
    await governor.connect(deployer).castVote(proposalId, 1); // For
    await governor.connect(voter1).castVote(proposalId, 1); // For

    // Wait for voting period to end
    await time.increase(VOTING_PERIOD + 1);

    // State should be Succeeded (4)
    expect(await governor.state(proposalId)).to.equal(4);

    // Queue to timelock
    await governor.queue(targets, values, calldatas, ethers.id(description));
    expect(await governor.state(proposalId)).to.equal(5); // Queued

    // Wait for timelock delay
    await time.increase(TIMELOCK_DELAY + 1);

    // Execute
    await governor.execute(targets, values, calldatas, ethers.id(description));
    expect(await governor.state(proposalId)).to.equal(7); // Executed

    // Verify the on-chain effect
    const activeVersion = await marketRegistry.activeVersion();
    expect(activeVersion.lendingCore).to.equal(await temporaryVersion.lendingCore.getAddress());
  });

  it("records for, against, and abstain votes correctly", async function () {
    const { deployer, voter1, voter2, voter3, governor, marketRegistry } = await loadFixture(deployFixture);

    // Propose a no-op (call to a view function is easiest, but let's use a real-ish target)
    const targets = [await marketRegistry.getAddress()];
    const values = [0n];
    // We can't actually call a view function as a proposal, so let's propose activateVersion(1) which is already active
    // This will revert on execution but that's fine for vote-counting
    const calldatas = [marketRegistry.interface.encodeFunctionData("activateVersion", [1n])];
    const description = "Test vote tallying proposal";

    await governor.connect(deployer).propose(targets, values, calldatas, description);
    const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.id(description));

    await time.increase(VOTING_DELAY + 1);

    // Cast votes: deployer=For(1), voter1=Against(0), voter2=Abstain(2), voter3=For(1)
    await governor.connect(deployer).castVote(proposalId, 1); // For
    await governor.connect(voter1).castVote(proposalId, 0); // Against
    await governor.connect(voter2).castVote(proposalId, 2); // Abstain
    await governor.connect(voter3).castVote(proposalId, 1); // For

    const [againstVotes, forVotes, abstainVotes] = await governor.proposalVotes(proposalId);

    const deployerVotes = await (await ethers.getContractAt("GovernanceToken", await governor.token())).getVotes(deployer.address);
    const voter1Votes = await (await ethers.getContractAt("GovernanceToken", await governor.token())).getVotes(voter1.address);
    const voter2Votes = await (await ethers.getContractAt("GovernanceToken", await governor.token())).getVotes(voter2.address);
    const voter3Votes = await (await ethers.getContractAt("GovernanceToken", await governor.token())).getVotes(voter3.address);

    expect(forVotes).to.equal(deployerVotes + voter3Votes);
    expect(againstVotes).to.equal(voter1Votes);
    expect(abstainVotes).to.equal(voter2Votes);
  });

  it("quorum check: proposal fails without sufficient quorum", async function () {
    const { voter3, governor, marketRegistry } = await loadFixture(deployFixture);

    // voter3 has 5% of supply, which exceeds 4% quorum alone, but let's use outsider with 0 votes
    // Actually, the quorum is 4% of total supply. Let's make a scenario where quorum is not met.
    // voter3 only has 50k out of 1M = 5% which is > 4%. We need someone with < 4%.
    // Let's transfer some tokens and have a sole voter with < 4%
    const targets = [await marketRegistry.getAddress()];
    const values = [0n];
    const calldatas = [marketRegistry.interface.encodeFunctionData("activateVersion", [1n])];
    const description = "Quorum test - insufficient votes";

    // Propose using voter3 who has 5% - enough to propose
    await governor.connect(voter3).propose(targets, values, calldatas, description);
    const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.id(description));

    await time.increase(VOTING_DELAY + 1);

    // Only voter3 votes Against (5% > 4% quorum) - but Against votes count toward quorum in OZ GovernorCountingSimple
    // So this proposal will be defeated but quorum met. To test quorum failure we need nobody voting.
    // Don't cast any votes.

    await time.increase(VOTING_PERIOD + 1);

    // State should be Defeated (3) because quorum not met (no votes at all)
    expect(await governor.state(proposalId)).to.equal(3);
  });

  it("defeated proposal cannot be queued", async function () {
    const { deployer, voter1, voter2, governor, marketRegistry } = await loadFixture(deployFixture);

    const targets = [await marketRegistry.getAddress()];
    const values = [0n];
    const calldatas = [marketRegistry.interface.encodeFunctionData("activateVersion", [1n])];
    const description = "Defeat this proposal";

    await governor.connect(deployer).propose(targets, values, calldatas, description);
    const proposalId = await governor.hashProposal(targets, values, calldatas, ethers.id(description));

    await time.increase(VOTING_DELAY + 1);

    // Majority votes against
    await governor.connect(deployer).castVote(proposalId, 0); // Against
    await governor.connect(voter1).castVote(proposalId, 0); // Against
    await governor.connect(voter2).castVote(proposalId, 1); // For (only 15%)

    await time.increase(VOTING_PERIOD + 1);

    // State should be Defeated (3)
    expect(await governor.state(proposalId)).to.equal(3);

    // Queue should revert
    await expect(governor.queue(targets, values, calldatas, ethers.id(description))).to.be.revertedWithCustomError(
      governor,
      "GovernorUnexpectedProposalState",
    );
  });

  it("deployer holds no admin roles after governed setup", async function () {
    const { deployer, accessManager, timelock } = await loadFixture(deployFixture);

    // Deployer should NOT have admin role (role 0)
    const [deployerIsAdmin] = await accessManager.hasRole(0, deployer.address);
    expect(deployerIsAdmin).to.equal(false);

    // Timelock SHOULD have admin role
    const [timelockIsAdmin] = await accessManager.hasRole(0, await timelock.getAddress());
    expect(timelockIsAdmin).to.equal(true);

    // Deployer should NOT be admin on the timelock itself
    const TIMELOCK_ADMIN_ROLE = await timelock.DEFAULT_ADMIN_ROLE();
    const deployerHasTimelockAdmin = await timelock.hasRole(TIMELOCK_ADMIN_ROLE, deployer.address);
    expect(deployerHasTimelockAdmin).to.equal(false);
  });

  it("direct version activation from EOA reverts", async function () {
    const { voter1, marketRegistry } = await loadFixture(deployFixture);

    // Direct call should revert with AccessManagedUnauthorized
    await expect(marketRegistry.connect(voter1).activateVersion(1n)).to.be.reverted;
  });

  it("governor has proposer and canceller roles on timelock", async function () {
    const { governor, timelock } = await loadFixture(deployFixture);

    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();

    expect(await timelock.hasRole(PROPOSER_ROLE, await governor.getAddress())).to.equal(true);
    expect(await timelock.hasRole(CANCELLER_ROLE, await governor.getAddress())).to.equal(true);
  });
});
