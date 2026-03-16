import { parseDeploymentManifest, type DeploymentManifest } from "../../lib/shared/deploymentManifest";
import manifestJson from "../../deployments/polkadot-hub-testnet-canonical.json";

export const deploymentManifest: DeploymentManifest = parseDeploymentManifest(manifestJson);
export const hasLivePolkadotHubTestnetDeployment = deploymentManifest.networkName === "polkadotHubTestnet";
