import { resolveInputs } from "@parity/resolc";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const resolcEntry = require.resolve("@parity/resolc");
const { resolc } = require(path.join(path.dirname(resolcEntry), "resolc.js"));

const outDir = path.join(process.cwd(), "pvm-artifacts");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const sources = {
  "contracts/pvm/PvmRiskEngine.sol": {
    content: readFileSync(path.join(process.cwd(), "contracts", "pvm", "PvmRiskEngine.sol"), "utf8"),
  },
  "contracts/interfaces/IRiskEngine.sol": {
    content: readFileSync(path.join(process.cwd(), "contracts", "interfaces", "IRiskEngine.sol"), "utf8"),
  },
};

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
        "*": ["abi", "evm.bytecode"],
      },
    },
  },
});

const result = resolc(input);
const fatalErrors = (result.errors ?? []).filter((entry) => entry.severity === "error");
if (fatalErrors.length > 0) {
  throw new Error(fatalErrors.map((entry) => entry.formattedMessage).join("\n\n"));
}

for (const contracts of Object.values(result.contracts)) {
  for (const [name, contract] of Object.entries(contracts)) {
    if (!contract.evm?.bytecode?.object) {
      continue;
    }

    writeFileSync(
      path.join(outDir, `${name}.json`),
      JSON.stringify(
        {
          abi: contract.abi,
          bytecode: `0x${contract.evm.bytecode.object}`,
        },
        null,
        2,
      ),
    );
  }
}

console.log(`Wrote PVM artifacts to ${outDir}`);
