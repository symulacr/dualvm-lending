import { createPublicClient, http, formatEther, formatUnits, parseAbi, getAddress } from 'viem';

const RPC_URL = 'https://eth-rpc-testnet.polkadot.io/';

const client = createPublicClient({
  transport: http(RPC_URL),
  chain: { id: 420420417, name: 'Polkadot Hub TestNet', nativeCurrency: { name: 'PAS', symbol: 'PAS', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } },
});

// Contracts
const USDC = '0x2d7e60571b478f8de5f25a8b494e7f4527310d34';
const WPAS = '0x5e18c7708d492c66d8ebd92ae208b74c069f18fc';
const LENDING_ENGINE = '0x11bf643d87b3f754b0852ff5243e795815765e7d';
const DEBT_POOL = '0xff42db4e29de3ccb206162fe51bc38a0283f652b';
const ORACLE = '0xfe5636f2b5be3f97a604958161030874e2e70810';
const RISK_GATEWAY = '0x5c66f69a04f3a460b1fabf971b8b4d2d18141bd4';
const GOV_POLICY_STORE = '0x0c8c0c8e2180c90798822ab85de176fe4d8c86cf';
const LENDING_ROUTER = '0x1b86e0103702ae58000e77cd415e2a1299a0c59c';
const ACCESS_MANAGER = '0xc126951a58644bd3d5e23c781263873c4305ccc8';

// ABIs
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

const oracleAbi = parseAbi([
  'function priceWad() view returns (uint256)',
  'function latestPriceWad() view returns (uint256)',
  'function lastUpdatedAt() view returns (uint256)',
  'function maxAge() view returns (uint256)',
  'function oracleEpoch() view returns (uint256)',
  'function isFresh() view returns (bool)',
]);

const debtPoolAbi = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function asset() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);

const lendingEngineAbi = parseAbi([
  'function collateralAsset() view returns (address)',
  'function debtAsset() view returns (address)',
  'function debtPool() view returns (address)',
  'function oracle() view returns (address)',
  'function positions(address) view returns (uint256 collateralAmount, uint256 debtPrincipal, uint256 debtScaledAmount, uint256 lastAccrualTimestamp)',
  'function currentDebt(address) view returns (uint256)',
  'function healthFactor(address) view returns (uint256)',
  'function paused() view returns (bool)',
  'function newDebtFrozen() view returns (bool)',
  'function borrowCap() view returns (uint256)',
  'function minBorrowAmount() view returns (uint256)',
  'function reserveFactorBps() view returns (uint256)',
  'function maxConfiguredLtvBps() view returns (uint256)',
  'function maxConfiguredLiquidationThresholdBps() view returns (uint256)',
  'function liquidationBonusBps() view returns (uint256)',
]);

const riskGatewayAbi = parseAbi([
  'function quoteEngine() view returns (address)',
]);

// Faucet wallets
const faucetWallets = [
  { label: 'Faucet-1',  addr: '0xF5D29698aeaE6CCdD685035c8b90A1Df53Cd3713' },
  { label: 'Faucet-2',  addr: '0x0d8b24b44A3AF07DA97eD9db2bf54B6ade3369aa' },
  { label: 'Faucet-3',  addr: '0xdd27520a511C99A798E6Ab479D70113c88e78cBB' },
  { label: 'Faucet-4',  addr: '0x16F203553C9d61dBec65e62A5260284ae2450747' },
  { label: 'Faucet-5',  addr: '0xBD086866D393835c0fE0D12e80Bb16Dd7F3d3C2A' },
  { label: 'Faucet-6',  addr: '0xB4f0B0ee133C4178Ceb714B27a9a6166e4d87E47' },
  { label: 'Faucet-7',  addr: '0x0F08E6973B719850C572d892515BF9041A090f67' },
  { label: 'Faucet-8',  addr: '0x4b3941a250A5E0037901c095b99957b918c6C041' },
  { label: 'Faucet-9',  addr: '0xD5107e62D08e67e14BE7DC2d4F219c5e0FA70a8c' },
  { label: 'Faucet-10', addr: '0x6fAAF46b312b982f2863f298424Dd1Eed002e558' },
  { label: 'Faucet-11', addr: '0xbf01e2f5B9be4759532c4fa77bF9BB99D9FaC6B1' },
  { label: 'Faucet-12', addr: '0x9E7cF74D020Ec579C44C87fEB20D648f15f4eea8' },
  { label: 'Faucet-13', addr: '0x40c0c974d6790a9Cfaa033b3f9aCE0e79B07b5f3' },
  { label: 'Faucet-14', addr: '0x0A45a29cb35aB5d873C92AD040013433C15F4F5D' },
  { label: 'Faucet-15', addr: '0x2d8De866B5234759bf7d2db9db34346a187411D5' },
];

// Role wallets (from .env) — derive deployer from private key
// Deployer PK: 0x0f4a628e9e814e1e8dd5e43001e80331bc5d70609434baa8f822ca7b962dba0e
// We need to derive the address. We'll use viem's privateKeyToAccount.
import { privateKeyToAccount } from 'viem/accounts';

const deployerAccount = privateKeyToAccount('0x0f4a628e9e814e1e8dd5e43001e80331bc5d70609434baa8f822ca7b962dba0e');
const emergencyAccount = privateKeyToAccount('0x89d219b3fa293a5c6292f0fc65083020568063346a1160eacdbb90f48b878510');
const riskAccount = privateKeyToAccount('0x268000aecd4899b06b220b216f56b8e191a39db7359ee8da1d2825cd3126fa31');
const minterAccount = privateKeyToAccount('0x5c3c988aa4d8e9ab3701bc7e486f52801b1dab3149114f1054355c87b9ad8828');
const lenderAccount = privateKeyToAccount('0xa91a80927091a8864ee76ca93a48d87f6f30dd4aeffce5f0a888119e53954c44');
const borrowerAccount = privateKeyToAccount('0x6a925a7709ce5d566f7b93053d0154524107fd108c7568a4d230dbf5c10ae648');
const liquidatorAccount = privateKeyToAccount('0xe60896aeb8235dd32081c0504c65c7ca16b13ab95af7422e11b6f8a5d0c59750');

const roleWallets = [
  { label: 'Deployer',      addr: deployerAccount.address },
  { label: 'Treasury',      addr: '0x519870b7b98a4FDc3D73cDb818634993cc942A86' },
  { label: 'EmergAdmin',    addr: emergencyAccount.address },
  { label: 'RiskAdmin',     addr: '0xE6E56B87EB128c081c59aC5a4EF8Bfe002E86944' },
  { label: 'RiskKey',       addr: riskAccount.address },
  { label: 'Minter',        addr: '0x26fdAba4D98899b31239C1d26a98C74872bD6976' },
  { label: 'MinterKey',     addr: minterAccount.address },
  { label: 'Lender',        addr: lenderAccount.address },
  { label: 'Borrower(.env)',addr: '0x222a2a8a203b4146f6036F1E08e86C9B85063b70' },
  { label: 'BorrowerKey',   addr: borrowerAccount.address },
  { label: 'Liquidator',    addr: liquidatorAccount.address },
];

// Deduplicate addresses across role wallets
const seenAddrs = new Set();
const dedupedRoleWallets = [];
for (const w of roleWallets) {
  const norm = w.addr.toLowerCase();
  if (!seenAddrs.has(norm)) {
    seenAddrs.add(norm);
    dedupedRoleWallets.push(w);
  } else {
    // Still show it but mark as duplicate
    dedupedRoleWallets.push({ ...w, label: w.label + ' (=dup)' });
  }
}

const allWallets = [...faucetWallets, ...dedupedRoleWallets];

async function safeCall(fn) {
  try {
    return await fn();
  } catch (e) {
    return `ERR: ${e.shortMessage || e.message}`.substring(0, 80);
  }
}

async function getBalances(addr) {
  const [pas, usdc, wpas] = await Promise.all([
    safeCall(() => client.getBalance({ address: addr })),
    safeCall(() => client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [addr] })),
    safeCall(() => client.readContract({ address: WPAS, abi: erc20Abi, functionName: 'balanceOf', args: [addr] })),
  ]);
  return { pas, usdc, wpas };
}

function fmt(val, decimals = 18) {
  if (typeof val === 'string') return val; // error
  return formatUnits(val, decimals);
}

async function main() {
  console.log('='.repeat(120));
  console.log('POLKADOT HUB TESTNET — WALLET BALANCE & CONTRACT STATE REPORT');
  console.log(`RPC: ${RPC_URL}  |  Chain ID: 420420417  |  Time: ${new Date().toISOString()}`);
  console.log('='.repeat(120));

  // Check block number
  const blockNumber = await client.getBlockNumber();
  console.log(`\nCurrent block: ${blockNumber}\n`);

  // 1. Wallet balances
  console.log('-'.repeat(120));
  console.log('WALLET BALANCES');
  console.log('-'.repeat(120));
  console.log(`${'Label'.padEnd(20)} ${'Address'.padEnd(44)} ${'PAS (native)'.padStart(22)} ${'USDC-test'.padStart(22)} ${'WPAS'.padStart(22)}`);
  console.log('-'.repeat(120));

  // Process in batches of 5 to avoid rate limiting
  for (let i = 0; i < allWallets.length; i += 5) {
    const batch = allWallets.slice(i, i + 5);
    const results = await Promise.all(batch.map(w => getBalances(w.addr)));
    for (let j = 0; j < batch.length; j++) {
      const w = batch[j];
      const r = results[j];
      console.log(
        `${w.label.padEnd(20)} ${w.addr.padEnd(44)} ${fmt(r.pas).padStart(22)} ${fmt(r.usdc).padStart(22)} ${fmt(r.wpas).padStart(22)}`
      );
    }
  }

  // 2. Contract states
  console.log('\n' + '='.repeat(120));
  console.log('CONTRACT STATE');
  console.log('='.repeat(120));

  // Oracle
  console.log('\n--- ManualOracle (' + ORACLE + ') ---');
  const [oraclePriceWad, oracleUpdated, oracleMaxAge, oracleEpoch, oracleFresh] = await Promise.all([
    safeCall(() => client.readContract({ address: ORACLE, abi: oracleAbi, functionName: 'priceWad' })),
    safeCall(() => client.readContract({ address: ORACLE, abi: oracleAbi, functionName: 'lastUpdatedAt' })),
    safeCall(() => client.readContract({ address: ORACLE, abi: oracleAbi, functionName: 'maxAge' })),
    safeCall(() => client.readContract({ address: ORACLE, abi: oracleAbi, functionName: 'oracleEpoch' })),
    safeCall(() => client.readContract({ address: ORACLE, abi: oracleAbi, functionName: 'isFresh' })),
  ]);
  console.log(`  priceWad:      ${typeof oraclePriceWad === 'bigint' ? formatEther(oraclePriceWad) + ' (raw: ' + oraclePriceWad + ')' : oraclePriceWad}`);
  console.log(`  lastUpdatedAt: ${typeof oracleUpdated === 'bigint' ? new Date(Number(oracleUpdated) * 1000).toISOString() + ' (epoch ' + oracleUpdated + ')' : oracleUpdated}`);
  console.log(`  maxAge:        ${typeof oracleMaxAge === 'bigint' ? oracleMaxAge + 's (' + (Number(oracleMaxAge)/3600).toFixed(1) + 'h)' : oracleMaxAge}`);
  console.log(`  oracleEpoch:   ${oracleEpoch}`);
  console.log(`  isFresh:       ${oracleFresh}`);

  // DebtPool (ERC4626)
  console.log('\n--- DebtPool (' + DEBT_POOL + ') ---');
  const [dpTotalAssets, dpTotalSupply, dpAsset, dpName, dpSymbol] = await Promise.all([
    safeCall(() => client.readContract({ address: DEBT_POOL, abi: debtPoolAbi, functionName: 'totalAssets' })),
    safeCall(() => client.readContract({ address: DEBT_POOL, abi: debtPoolAbi, functionName: 'totalSupply' })),
    safeCall(() => client.readContract({ address: DEBT_POOL, abi: debtPoolAbi, functionName: 'asset' })),
    safeCall(() => client.readContract({ address: DEBT_POOL, abi: debtPoolAbi, functionName: 'name' })),
    safeCall(() => client.readContract({ address: DEBT_POOL, abi: debtPoolAbi, functionName: 'symbol' })),
  ]);
  console.log(`  name:          ${dpName}`);
  console.log(`  symbol:        ${dpSymbol}`);
  console.log(`  asset:         ${dpAsset}`);
  console.log(`  totalAssets:   ${typeof dpTotalAssets === 'bigint' ? formatEther(dpTotalAssets) + ' USDC' : dpTotalAssets}`);
  console.log(`  totalSupply:   ${typeof dpTotalSupply === 'bigint' ? formatEther(dpTotalSupply) + ' shares' : dpTotalSupply}`);

  // LendingEngine
  console.log('\n--- LendingEngine (' + LENDING_ENGINE + ') ---');
  const [leCollAsset, leDebtAsset, leDebtPool, leOracle, lePaused, leDebtFrozen, leBorrowCap, leMinBorrow, leReserveBps, leMaxLtv, leLiqThresh, leLiqBonus] = await Promise.all([
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'collateralAsset' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'debtAsset' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'debtPool' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'oracle' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'paused' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'newDebtFrozen' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'borrowCap' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'minBorrowAmount' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'reserveFactorBps' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'maxConfiguredLtvBps' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'maxConfiguredLiquidationThresholdBps' })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'liquidationBonusBps' })),
  ]);
  console.log(`  collateralAsset:  ${leCollAsset}`);
  console.log(`  debtAsset:        ${leDebtAsset}`);
  console.log(`  debtPool:         ${leDebtPool}`);
  console.log(`  oracle:           ${leOracle}`);
  console.log(`  paused:           ${lePaused}`);
  console.log(`  newDebtFrozen:    ${leDebtFrozen}`);
  console.log(`  borrowCap:        ${typeof leBorrowCap === 'bigint' ? formatEther(leBorrowCap) : leBorrowCap}`);
  console.log(`  minBorrowAmount:  ${typeof leMinBorrow === 'bigint' ? formatEther(leMinBorrow) : leMinBorrow}`);
  console.log(`  reserveFactorBps: ${leReserveBps} (${typeof leReserveBps === 'bigint' ? Number(leReserveBps)/100 + '%' : ''})`);
  console.log(`  maxLtvBps:        ${leMaxLtv} (${typeof leMaxLtv === 'bigint' ? Number(leMaxLtv)/100 + '%' : ''})`);
  console.log(`  liqThresholdBps:  ${leLiqThresh} (${typeof leLiqThresh === 'bigint' ? Number(leLiqThresh)/100 + '%' : ''})`);
  console.log(`  liqBonusBps:      ${leLiqBonus} (${typeof leLiqBonus === 'bigint' ? Number(leLiqBonus)/100 + '%' : ''})`);

  // Check collateral/debt of known borrower
  console.log('\n  --- Borrower positions ---');
  const borrowerAddr = '0x222a2a8a203b4146f6036F1E08e86C9B85063b70';
  const [borrowerPos, borrowerDebt] = await Promise.all([
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'positions', args: [borrowerAddr] })),
    safeCall(() => client.readContract({ address: LENDING_ENGINE, abi: lendingEngineAbi, functionName: 'currentDebt', args: [borrowerAddr] })),
  ]);
  if (Array.isArray(borrowerPos)) {
    console.log(`  Borrower ${borrowerAddr}:`);
    console.log(`    collateral:    ${formatEther(borrowerPos[0])} WPAS`);
    console.log(`    debtPrincipal: ${formatEther(borrowerPos[1])} USDC`);
    console.log(`    currentDebt:   ${typeof borrowerDebt === 'bigint' ? formatEther(borrowerDebt) : borrowerDebt} USDC`);
  } else {
    console.log(`  Borrower position: ${borrowerPos}`);
    console.log(`  Borrower currentDebt: ${borrowerDebt}`);
  }

  // RiskGateway
  console.log('\n--- RiskGateway (' + RISK_GATEWAY + ') ---');
  const quoteEngine = await safeCall(() => client.readContract({ address: RISK_GATEWAY, abi: riskGatewayAbi, functionName: 'quoteEngine' }));
  console.log(`  quoteEngine:   ${quoteEngine}`);

  // Token supplies
  console.log('\n--- Token Total Supplies ---');
  const [usdcSupply, wpasSupply] = await Promise.all([
    safeCall(() => client.readContract({ address: USDC, abi: erc20Abi, functionName: 'totalSupply' })),
    safeCall(() => client.readContract({ address: WPAS, abi: erc20Abi, functionName: 'totalSupply' })),
  ]);
  console.log(`  USDC-test totalSupply: ${typeof usdcSupply === 'bigint' ? formatEther(usdcSupply) : usdcSupply}`);
  console.log(`  WPAS totalSupply:      ${typeof wpasSupply === 'bigint' ? formatEther(wpasSupply) : wpasSupply}`);

  // USDC balance of DebtPool (TVL indicator)
  const dpUsdcBal = await safeCall(() => client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [DEBT_POOL] }));
  console.log(`\n  USDC held by DebtPool:    ${typeof dpUsdcBal === 'bigint' ? formatEther(dpUsdcBal) : dpUsdcBal}`);
  
  // WPAS balance of LendingEngine (collateral TVL)
  const leWpasBal = await safeCall(() => client.readContract({ address: WPAS, abi: erc20Abi, functionName: 'balanceOf', args: [LENDING_ENGINE] }));
  console.log(`  WPAS held by LendingEngine: ${typeof leWpasBal === 'bigint' ? formatEther(leWpasBal) : leWpasBal}`);

  console.log('\n' + '='.repeat(120));
  console.log('END OF REPORT');
  console.log('='.repeat(120));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
