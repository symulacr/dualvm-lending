import { writeFileSync } from "node:fs";
import path from "node:path";
import { getProbeResultsPath, loadProbeDeploymentManifest, loadProbeResultsManifest, writeProbeResultsManifest } from "../../lib/probes/probeStore";
import { runEntrypoint } from "../../lib/runtime/entrypoint";

function sectionStatus(status: string | undefined) {
  return status ?? "not-run";
}

function formatDeploymentRow(name: string, deployment?: { address: string; deployTxHash: string; explorerUrl: string; codeHash?: string }) {
  if (!deployment) {
    return `| ${name} | not deployed | - | - | - |`;
  }

  return `| ${name} | ${deployment.address} | ${deployment.deployTxHash} | ${deployment.codeHash ?? "-"} | ${deployment.explorerUrl} |`;
}

function formatStageSection(title: string, stage: any) {
  if (!stage) {
    return `## ${title}\n\nNot executed.\n`;
  }

  const lines = [`## ${title}`, ``, `Status: ${stage.status}`, ``, stage.summary ?? ""];
  if (stage.txHash) {
    lines.push("", `Tx: ${stage.txHash}`, `Explorer: ${stage.explorerUrl ?? "n/a"}`);
  }
  if (stage.error) {
    lines.push("", `Error: ${stage.error}`);
  }
  if (stage.expected) {
    lines.push("", "Expected:", "```json", JSON.stringify(stage.expected, null, 2), "```");
  }
  if (stage.observed) {
    lines.push("", "Observed:", "```json", JSON.stringify(stage.observed, null, 2), "```");
  }
  if (stage.readbacks) {
    lines.push("", "Readbacks:", "```json", JSON.stringify(stage.readbacks, null, 2), "```");
  }
  if (stage.subresults) {
    lines.push("", "Subresults:", "```json", JSON.stringify(stage.subresults, null, 2), "```");
  }
  lines.push("");
  return lines.join("\n");
}

export async function main() {
  const deployment = loadProbeDeploymentManifest();
  const results = loadProbeResultsManifest();
  const stage1DirectCompute = results.stages.stage1Echo?.status === "passed" && results.stages.stage1Quote?.status === "passed";
  const stage2Callback = results.stages.stage2?.status === "passed";
  const stage3Roundtrip = results.stages.stage3?.status === "passed";

  results.verdicts = {
    A: stage1DirectCompute,
    B: stage3Roundtrip,
    C: stage2Callback,
    D: !stage1DirectCompute && !stage2Callback && !stage3Roundtrip,
  };

  results.finalSummary = results.verdicts.B
    ? "Outcome B proven: REVM -> PVM -> REVM roundtrip settlement was demonstrated on the public testnet."
    : results.verdicts.A && results.verdicts.C
      ? "Outcomes A and C proven: direct REVM -> PVM compute and PVM -> REVM callback both landed on-chain, but roundtrip settlement was not proven."
      : results.verdicts.A
        ? "Outcome A proven: direct REVM -> PVM compute was demonstrated, but bidirectional settlement was not proven."
        : results.verdicts.C
          ? "Outcome C proven: a PVM-originated callback changed REVM state, but direct REVM -> PVM compute / roundtrip settlement were not proven."
          : "Outcome D holds: live native VM interoperability is not defensible from the current public testnet evidence set.";

  const stage0Status = deployment.pvm.quoteProbe && deployment.pvm.callbackProbe && deployment.revm.callbackReceiver && deployment.revm.quoteCaller && deployment.revm.roundTripSettlement
    ? "passed"
    : "failed";
  results.stages.stage0 = {
    status: stage0Status,
    summary:
      stage0Status === "passed"
        ? "Both REVM and PVM probe targets exist on the public Polkadot Hub TestNet with recorded deployment transactions."
        : "Probe deployment evidence is incomplete; not all required REVM/PVM probe targets were deployed and recorded.",
    readbacks: {
      pvmQuoteProbe: deployment.pvm.quoteProbe?.address ?? null,
      pvmCallbackProbe: deployment.pvm.callbackProbe?.address ?? null,
      revmCallbackReceiver: deployment.revm.callbackReceiver?.address ?? null,
      revmQuoteCaller: deployment.revm.quoteCaller?.address ?? null,
      revmRoundTripSettlement: deployment.revm.roundTripSettlement?.address ?? null,
    },
  };

  const outResultsPath = writeProbeResultsManifest(results);
  const docPath = path.join(process.cwd(), "../docs/dualvm/dualvm_vm_interop_proof.md");
  const markdown = [
    "# DualVM VM Interop Proof",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Network",
    "",
    `- Name: ${deployment.polkadotHubTestnet.name}`,
    `- Chain ID: ${deployment.polkadotHubTestnet.chainId}`,
    `- HTTP RPC: ${deployment.polkadotHubTestnet.rpcUrl}`,
    `- WSS RPC: ${deployment.polkadotHubTestnet.wssUrl}`,
    `- Explorer: ${deployment.polkadotHubTestnet.explorerUrl}`,
    `- Faucet: ${deployment.polkadotHubTestnet.faucetUrl}`,
    "",
    "## Operator",
    "",
    "```json",
    JSON.stringify(deployment.operator ?? null, null, 2),
    "```",
    "",
    "## Official documentation boundary",
    "",
    "Public Polkadot documentation proves that Polkadot Hub TestNet is the canonical current smart-contract testnet, that PVM is available in preview/early-stage form, and that PVM deployment uses a two-step/upload-or-instantiate revive path. It does not provide a public, end-to-end tutorial that proves native REVM<->PVM invocation on the live public testnet. This proof artifact therefore relies on direct on-chain deployment/execution evidence below.",
    "",
    "## Deployed probe contracts",
    "",
    "| Probe | Address | Deploy tx | Code hash / target id | Explorer |",
    "| --- | --- | --- | --- | --- |",
    formatDeploymentRow("PvmQuoteProbe", deployment.pvm.quoteProbe),
    formatDeploymentRow("PvmCallbackProbe", deployment.pvm.callbackProbe),
    formatDeploymentRow("RevmCallbackReceiver", deployment.revm.callbackReceiver),
    formatDeploymentRow("RevmQuoteCallerProbe", deployment.revm.quoteCaller),
    formatDeploymentRow("RevmRoundTripSettlementProbe", deployment.revm.roundTripSettlement),
    "",
    "## Stage summary",
    "",
    `- Stage 0: ${sectionStatus(results.stages.stage0?.status)}`,
    `- Stage 1A: ${sectionStatus(results.stages.stage1Echo?.status)}`,
    `- Stage 1B: ${sectionStatus(results.stages.stage1Quote?.status)}`,
    `- Stage 2: ${sectionStatus(results.stages.stage2?.status)}`,
    `- Stage 3: ${sectionStatus(results.stages.stage3?.status)}`,
    "",
    formatStageSection("Stage 0 — Capability gate", results.stages.stage0),
    formatStageSection("Stage 1A — REVM -> PVM echo", results.stages.stage1Echo),
    formatStageSection("Stage 1B — REVM -> PVM deterministic quote", results.stages.stage1Quote),
    formatStageSection("Stage 2 — PVM -> REVM callback", results.stages.stage2),
    formatStageSection("Stage 3 — Roundtrip settlement", results.stages.stage3),
    "## Final verdict",
    "",
    `- A. REVM -> PVM direct compute proven: ${results.verdicts.A}`,
    `- B. REVM -> PVM -> REVM roundtrip settlement proven: ${results.verdicts.B}`,
    `- C. PVM -> REVM callback proven: ${results.verdicts.C}`,
    `- D. Direct VM interop not defensible on current public testnet/tooling: ${results.verdicts.D}`,
    "",
    results.finalSummary,
    "",
    `Probe results JSON: \`${getProbeResultsPath()}\``,
    `Results file updated at: \`${outResultsPath}\``,
    "",
  ].join("\n");

  writeFileSync(docPath, markdown);
  console.log(JSON.stringify({ outResultsPath, docPath, verdicts: results.verdicts, finalSummary: results.finalSummary }, null, 2));
}

runEntrypoint("scripts/probes/collect-proof.ts", main);
