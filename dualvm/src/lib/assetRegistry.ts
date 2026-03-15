import { deploymentManifest } from "./manifest";

export interface AssetRegistryEntry {
  symbol: string;
  name: string;
  role: string;
  decimals: number;
  address: string;
  source: string;
  truthModel: string;
  notes: string;
  upgradePath: string;
}

export const assetRegistry: AssetRegistryEntry[] = [
  {
    symbol: "WPAS",
    name: "Wrapped PAS",
    role: "Collateral asset",
    decimals: 18,
    address: deploymentManifest.contracts.wpas,
    source: "Native PAS wrapped 1:1 into ERC-20 semantics",
    truthModel: "Real native testnet gas asset wrapped for EVM-friendly collateral handling",
    notes: "This is the actual live collateral path on Polkadot Hub TestNet.",
    upgradePath: "Can later share a more general collateral adapter path if native/precompile abstractions expand.",
  },
  {
    symbol: "USDC-test",
    name: "USDC-test",
    role: "Debt asset and LP asset",
    decimals: 18,
    address: deploymentManifest.contracts.usdc,
    source: "Team-controlled mock ERC-20 deployed for the MVP",
    truthModel: "Intentional mock stablecoin used to avoid metadata ambiguity and fake realism in the critical path",
    notes: "Used honestly as a testnet debt asset. It is not presented as a production stablecoin integration.",
    upgradePath: "Future production path should be a metadata-safe real asset or adapter-backed asset once oracle quality and token integration are ready.",
  },
];
