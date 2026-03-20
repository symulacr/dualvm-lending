/** Governance Setup — delegates, proposes, votes, queues, executes. Usage: node scripts/governance-setup.mjs */
import { config } from "dotenv"; config();
import { createWalletClient, createPublicClient, http, encodeFunctionData, keccak256, toHex, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";

const RPC_URL = process.env.POLKADOT_HUB_TESTNET_RPC_URL ?? "https://eth-rpc-testnet.polkadot.io/";
const deployerKey = process.env.PRIVATE_KEY;
if (!deployerKey) { console.error("PRIVATE_KEY missing in .env"); process.exit(1); }

const chain = { id: 420420417, name: "Polkadot Hub TestNet", nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } };
const account = privateKeyToAccount(deployerKey);
const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

const manifest = JSON.parse(readFileSync(new URL("../deployments/deploy-manifest.json", import.meta.url), "utf8"));
const ADDR = { am: manifest.accessManager, token: manifest.governanceToken, gov: manifest.dualVMGovernor, usdc: manifest.usdcMock };
const RELAYER = "0xF5D29698aeaE6CCdD685035c8b90A1Df53Cd3713";
const ROLE_RISK_ADMIN = 2n;
const ROLE_USDC_MINTER = 10n;
const MINT_SELECTOR = "0x40c10f19";

const govTokenAbi = parseAbi(["function delegate(address)", "function getVotes(address) view returns (uint256)"]);
const governorAbi = parseAbi([
  "function propose(address[],uint256[],bytes[],string) returns (uint256)",
  "function castVote(uint256,uint8) returns (uint256)",
  "function queue(address[],uint256[],bytes[],bytes32)",
  "function execute(address[],uint256[],bytes[],bytes32) payable",
  "function state(uint256) view returns (uint8)",
  "function hashProposal(address[],uint256[],bytes[],bytes32) view returns (uint256)",
]);
const amAbi = parseAbi([
  "function setTargetFunctionRole(address,bytes4[],uint64)",
  "function grantRole(uint64,address,uint32)",
]);

const ts = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitTx(hash) {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`TX reverted: ${hash}`);
  return r;
}
async function getState(pid) {
  return publicClient.readContract({ address: ADDR.gov, abi: governorAbi, functionName: "state", args: [pid] });
}

async function main() {
  console.log(`[${ts()}] Deployer: ${account.address} | Relayer: ${RELAYER}`);

  // 1. Self-delegate
  console.log(`[${ts()}] Step 1: Self-delegating...`);
  const d = await walletClient.writeContract({ address: ADDR.token, abi: govTokenAbi, functionName: "delegate", args: [account.address] });
  await waitTx(d);
  const votes = await publicClient.readContract({ address: ADDR.token, abi: govTokenAbi, functionName: "getVotes", args: [account.address] });
  console.log(`[${ts()}]   TX: ${d} | Votes: ${votes}`);

  // 2. Propose
  console.log(`[${ts()}] Step 2: Creating proposal...`);
  const targets = [ADDR.am, ADDR.am, ADDR.am];
  const values = [0n, 0n, 0n];
  const calldatas = [
    encodeFunctionData({ abi: amAbi, functionName: "setTargetFunctionRole", args: [ADDR.usdc, [MINT_SELECTOR], ROLE_USDC_MINTER] }),
    encodeFunctionData({ abi: amAbi, functionName: "grantRole", args: [ROLE_USDC_MINTER, RELAYER, 0] }),
    encodeFunctionData({ abi: amAbi, functionName: "grantRole", args: [ROLE_RISK_ADMIN, account.address, 0] }),
  ];
  const desc = "Grant USDC minter role to relayer and risk admin to deployer for oracle updates";
  const descHash = keccak256(toHex(desc));

  const pTx = await walletClient.writeContract({ address: ADDR.gov, abi: governorAbi, functionName: "propose", args: [targets, values, calldatas, desc] });
  await waitTx(pTx);
  const proposalId = await publicClient.readContract({ address: ADDR.gov, abi: governorAbi, functionName: "hashProposal", args: [targets, values, calldatas, descHash] });
  console.log(`[${ts()}]   TX: ${pTx} | Proposal: ${proposalId}`);

  // 3. Wait voting delay
  console.log(`[${ts()}] Step 3: Waiting 2s for voting delay...`);
  await sleep(2000);
  console.log(`[${ts()}]   State: ${await getState(proposalId)} (1=Active)`);

  // 4. Vote FOR
  console.log(`[${ts()}] Step 4: Casting FOR vote...`);
  const vTx = await walletClient.writeContract({ address: ADDR.gov, abi: governorAbi, functionName: "castVote", args: [proposalId, 1] });
  await waitTx(vTx);
  console.log(`[${ts()}]   TX: ${vTx}`);

  // 5. Wait voting period (310s)
  console.log(`[${ts()}] Step 5: Waiting 310s for voting period...`);
  for (let i = 0; i < 31; i++) {
    await sleep(10000);
    const e = (i + 1) * 10;
    if (e % 60 === 0 || e >= 300) console.log(`[${ts()}]   ${e}s elapsed, state: ${await getState(proposalId)}`);
  }
  let st = await getState(proposalId);
  console.log(`[${ts()}]   Final voting state: ${st} (4=Succeeded)`);
  if (Number(st) !== 4) { console.error(`Proposal not succeeded (state=${st}). Aborting.`); process.exit(1); }

  // 6. Queue
  console.log(`[${ts()}] Step 6: Queuing...`);
  const qTx = await walletClient.writeContract({ address: ADDR.gov, abi: governorAbi, functionName: "queue", args: [targets, values, calldatas, descHash] });
  await waitTx(qTx);
  console.log(`[${ts()}]   TX: ${qTx}`);

  // 7. Wait timelock (65s)
  console.log(`[${ts()}] Step 7: Waiting 65s for timelock...`);
  await sleep(65000);

  // 8. Execute
  console.log(`[${ts()}] Step 8: Executing...`);
  const eTx = await walletClient.writeContract({ address: ADDR.gov, abi: governorAbi, functionName: "execute", args: [targets, values, calldatas, descHash] });
  await waitTx(eTx);
  console.log(`[${ts()}]   TX: ${eTx}`);
  console.log(`\n[${ts()}] ✅ Governance setup complete! State: ${await getState(proposalId)} (7=Executed)`);
}

main().catch((err) => { console.error(`[${ts()}] ❌ Fatal:`, err.message ?? err); process.exit(1); });
