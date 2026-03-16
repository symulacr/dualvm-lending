import { resolveInputs } from "@parity/resolc";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const resolcEntry = require.resolve("@parity/resolc");
const { resolc } = require(path.join(path.dirname(resolcEntry), "resolc.js"));

const outDir = path.join(process.cwd(), "pvm-artifacts", "probes");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const sourcePaths = [
  "contracts/interfaces/IRiskEngine.sol",
  "contracts/probes/DualVmProbeLib.sol",
  "contracts/probes/interfaces/IRevmCallbackReceiver.sol",
  "contracts/probes/pvm/PvmQuoteProbe.sol",
  "contracts/probes/pvm/PvmCallbackProbe.sol",
];

const sources = Object.fromEntries(
  sourcePaths.map((sourcePath) => [sourcePath, { content: readFileSync(path.join(process.cwd(), sourcePath), "utf8") }]),
);

const input = JSON.stringify({
  language: "Solidity",
  sources: resolveInputs(sources),
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
      mode: "z",
    },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode", "metadata"],
      },
    },
  },
});

const result = resolc(input);
const fatalErrors = (result.errors ?? []).filter((entry) => entry.severity === "error");
if (fatalErrors.length > 0) {
  throw new Error(fatalErrors.map((entry) => entry.formattedMessage).join("\n\n"));
}

const targets = [
  ["contracts/probes/pvm/PvmQuoteProbe.sol", "PvmQuoteProbe"],
  ["contracts/probes/pvm/PvmCallbackProbe.sol", "PvmCallbackProbe"],
];

for (const [sourcePath, contractName] of targets) {
  const contract = result.contracts[sourcePath]?.[contractName];
  if (!contract?.evm?.bytecode?.object) {
    throw new Error(`Missing bytecode for ${contractName}`);
  }

  writeFileSync(
    path.join(outDir, `${contractName}.json`),
    JSON.stringify(
      {
        contractName,
        sourcePath,
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
        compiler: {
          reviveVersion: contract.metadata?.revive_version,
          objectFormat: contract.objectFormat,
        },
      },
      null,
      2,
    ),
  );
}

console.log(JSON.stringify({ outDir, contracts: targets.map(([, contractName]) => contractName) }, null, 2));
