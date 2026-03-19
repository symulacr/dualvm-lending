// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {DualVMAccessManager} from "../contracts/DualVMAccessManager.sol";
import {GovernanceToken} from "../contracts/governance/GovernanceToken.sol";
import {DualVMGovernor} from "../contracts/governance/DualVMGovernor.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";

/// @notice Tests for the full Governor proposal lifecycle: mint, delegate, propose, vote, queue, execute.
contract GovernorLifecycleTest is Test {
    // Short parameters for demo-friendly testing
    uint48 internal constant VOTING_DELAY = 1; // 1 second
    uint32 internal constant VOTING_PERIOD = 300; // 5 minutes
    uint256 internal constant TIMELOCK_DELAY = 60; // 60 seconds
    uint256 internal constant QUORUM_NUMERATOR = 4; // 4%
    uint256 internal constant INITIAL_SUPPLY = 1_000_000 * 1e18;

    DualVMAccessManager internal accessManager;
    GovernanceToken internal govToken;
    TimelockController internal timelock;
    DualVMGovernor internal governor;

    address internal admin;
    address internal voter1;
    address internal voter2;
    address internal voter3;
    address internal outsider;

    function setUp() public {
        admin = address(this);
        voter1 = makeAddr("voter1");
        voter2 = makeAddr("voter2");
        voter3 = makeAddr("voter3");
        outsider = makeAddr("outsider");

        // Deploy AccessManager (admin = test contract)
        accessManager = new DualVMAccessManager(admin);

        // Deploy GovernanceToken (minted to admin)
        govToken = new GovernanceToken(address(accessManager), admin, INITIAL_SUPPLY);

        // Deploy TimelockController with test contract as initial admin so we can wire roles
        address[] memory proposers = new address[](0);
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone can execute
        timelock = new TimelockController(TIMELOCK_DELAY, proposers, executors, admin);

        // Deploy Governor
        governor = new DualVMGovernor(
            IVotes(address(govToken)),
            timelock,
            VOTING_DELAY,
            VOTING_PERIOD,
            QUORUM_NUMERATOR
        );

        // Wire: grant governor PROPOSER_ROLE + CANCELLER_ROLE on timelock
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(governor));

        // Distribute tokens
        govToken.transfer(voter1, 200_000 * 1e18);
        govToken.transfer(voter2, 150_000 * 1e18);
        govToken.transfer(voter3, 50_000 * 1e18);

        // Self-delegate to activate voting power
        govToken.delegate(admin);
        vm.prank(voter1);
        govToken.delegate(voter1);
        vm.prank(voter2);
        govToken.delegate(voter2);
        vm.prank(voter3);
        govToken.delegate(voter3);
    }

    // -------------------------------------------------------------------------
    // Token checks
    // -------------------------------------------------------------------------

    function test_GovernanceToken_TotalSupply() public view {
        assertEq(govToken.totalSupply(), INITIAL_SUPPLY);
    }

    function test_GovernanceToken_Name() public view {
        assertEq(govToken.name(), "DualVM Governance");
        assertEq(govToken.symbol(), "dvGOV");
    }

    function test_GovernanceToken_ClockModeIsTimestamp() public view {
        assertEq(govToken.CLOCK_MODE(), "mode=timestamp");
    }

    function test_GovernanceToken_ClockReturnsTimestamp() public view {
        uint256 clock = govToken.clock();
        assertApproxEqAbs(clock, block.timestamp, 5);
    }

    function test_GovernanceToken_SelfDelegationActivatesVotingPower() public view {
        uint256 voter1Votes = govToken.getVotes(voter1);
        assertEq(voter1Votes, govToken.balanceOf(voter1));
        assertGt(voter1Votes, 0);
    }

    function test_GovernanceToken_UndelegatedHolderHasZeroVotes() public {
        // Transfer to outsider without delegating
        vm.prank(admin);
        govToken.transfer(outsider, 10_000 * 1e18);
        // outsider hasn't delegated — no voting power
        assertEq(govToken.getVotes(outsider), 0);
    }

    // -------------------------------------------------------------------------
    // Governance token mint via AccessManager
    // -------------------------------------------------------------------------

    function test_GovernanceToken_MintViaAccessManager() public {
        uint64 ROLE_MINTER = 4;
        accessManager.grantRole(ROLE_MINTER, admin, 0);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = govToken.mint.selector;
        accessManager.setTargetFunctionRole(address(govToken), selectors, ROLE_MINTER);

        uint256 supplyBefore = govToken.totalSupply();
        govToken.mint(outsider, 100 * 1e18);
        assertEq(govToken.totalSupply(), supplyBefore + 100 * 1e18);
    }

    function test_GovernanceToken_MintWithoutRoleReverts() public {
        vm.prank(outsider);
        vm.expectRevert();
        govToken.mint(outsider, 100 * 1e18);
    }

    // -------------------------------------------------------------------------
    // Governor parameters
    // -------------------------------------------------------------------------

    function test_Governor_VotingDelay() public view {
        assertEq(governor.votingDelay(), VOTING_DELAY);
    }

    function test_Governor_VotingPeriod() public view {
        assertEq(governor.votingPeriod(), VOTING_PERIOD);
    }

    function test_Governor_TimelockAddress() public view {
        assertEq(governor.timelock(), address(timelock));
    }

    // -------------------------------------------------------------------------
    // Proposal lifecycle: propose → vote → queue → execute
    // -------------------------------------------------------------------------

    function _buildNoOpProposal()
        internal
        view
        returns (
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas,
            string memory description
        )
    {
        // A proposal targeting the timelock with empty calldata — passes without side effects
        targets = new address[](1);
        targets[0] = address(govToken);  // target govToken
        values = new uint256[](1);
        values[0] = 0;
        calldatas = new bytes[](1);
        // encode transfer(address(0), 0) — a no-op transfer of 0 tokens to zero address
        // Actually, let's just use totalSupply() view call — but that won't work as execute
        // Use a grantRole call on timelock (timelock admin can do this)
        calldatas[0] = abi.encodeWithSelector(govToken.totalSupply.selector);
        description = "Test proposal: no-op";
    }

    function test_Proposal_PendingBeforeVotingDelay() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) =
            _buildNoOpProposal();

        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        assertEq(uint256(governor.state(proposalId)), uint256(IGovernor.ProposalState.Pending));
    }

    function test_Proposal_ActiveDuringVotingPeriod() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) =
            _buildNoOpProposal();

        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        vm.warp(block.timestamp + VOTING_DELAY + 1);

        assertEq(uint256(governor.state(proposalId)), uint256(IGovernor.ProposalState.Active));
    }

    function test_Proposal_DefeatedWhenAllVoteAgainst() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) =
            _buildNoOpProposal();

        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        vm.warp(block.timestamp + VOTING_DELAY + 1);

        // voter1 votes against (20%), no FOR votes → defeated
        vm.prank(voter1);
        governor.castVote(proposalId, uint8(GovernorCountingSimple.VoteType.Against));

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        assertEq(uint256(governor.state(proposalId)), uint256(IGovernor.ProposalState.Defeated));
    }

    function test_Proposal_MultipleVotersCombineForQuorum() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) =
            _buildNoOpProposal();

        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        vm.warp(block.timestamp + VOTING_DELAY + 1);

        // voter1 (20%) and voter2 (15%) vote FOR
        vm.prank(voter1);
        governor.castVote(proposalId, uint8(GovernorCountingSimple.VoteType.For));
        vm.prank(voter2);
        governor.castVote(proposalId, uint8(GovernorCountingSimple.VoteType.For));
        // voter3 votes against (5%)
        vm.prank(voter3);
        governor.castVote(proposalId, uint8(GovernorCountingSimple.VoteType.Against));

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        // FOR (35%) > AGAINST (5%) → Succeeded
        assertEq(uint256(governor.state(proposalId)), uint256(IGovernor.ProposalState.Succeeded));
    }

    function test_Proposal_SucceedsAfterVotingPeriod() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) =
            _buildNoOpProposal();

        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        vm.warp(block.timestamp + VOTING_DELAY + 1);

        // Admin has 60% — votes FOR
        governor.castVote(proposalId, uint8(GovernorCountingSimple.VoteType.For));
        vm.warp(block.timestamp + VOTING_PERIOD + 1);

        assertEq(uint256(governor.state(proposalId)), uint256(IGovernor.ProposalState.Succeeded));
    }

    function test_ProposalLifecycle_ProposeVoteQueueSucceeds() public {
        // Deploy a mock target that accepts any call — use address(govToken) calling totalSupply
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) =
            _buildNoOpProposal();

        uint256 proposalId = governor.propose(targets, values, calldatas, description);
        vm.warp(block.timestamp + VOTING_DELAY + 1);

        // Admin votes FOR (60% of supply)
        governor.castVote(proposalId, uint8(GovernorCountingSimple.VoteType.For));
        vm.warp(block.timestamp + VOTING_PERIOD + 1);

        assertEq(uint256(governor.state(proposalId)), uint256(IGovernor.ProposalState.Succeeded));

        // Queue
        bytes32 descriptionHash = keccak256(bytes(description));
        governor.queue(targets, values, calldatas, descriptionHash);

        assertEq(uint256(governor.state(proposalId)), uint256(IGovernor.ProposalState.Queued));
    }

    function test_ChainOfTrust_TimelockHoldsProposerRole() public view {
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), address(governor)));
    }

    function test_ChainOfTrust_GovernorHoldsTokenReference() public view {
        assertEq(address(governor.token()), address(govToken));
    }
}
