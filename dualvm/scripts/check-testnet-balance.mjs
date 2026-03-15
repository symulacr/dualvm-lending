const inputAddress = process.argv[2];

if (!inputAddress || !/^0x[a-fA-F0-9]{40}$/.test(inputAddress)) {
  console.error("Usage: node scripts/check-testnet-balance.mjs 0xYourEvmAddress");
  process.exit(1);
}

const rpcUrl = process.env.POLKADOT_HUB_TESTNET_RPC_URL ?? "https://eth-rpc-testnet.polkadot.io/";

const response = await fetch(rpcUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getBalance",
    params: [inputAddress, "latest"],
  }),
});

const body = await response.json();
if (body.error) {
  console.error(JSON.stringify(body.error, null, 2));
  process.exit(1);
}

const wei = BigInt(body.result);
const whole = wei / 10n ** 18n;
const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "") || "0";

console.log(JSON.stringify({
  rpcUrl,
  address: inputAddress,
  chainId: 420420417,
  wei: wei.toString(),
  pas: `${whole}.${fraction}`,
}, null, 2));
