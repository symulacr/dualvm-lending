import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { compactAddLength, hexToU8a } from "@polkadot/util";
import { cryptoWaitReady, encodeAddress } from "@polkadot/util-crypto";
import { formatUnits } from "viem";
import type { HexValue } from "./probeStore";
import { POLKADOT_HUB_TESTNET_WSS_URL } from "./probeStore";

export interface ProbePvmIdentity {
  evmAddress: HexValue;
  fallbackAccountHex: HexValue;
  paseoSs58: string;
}

export interface PvmFinalizedTx {
  txHash: HexValue;
  blockHash: HexValue;
  events: any[];
}

function normalizeHexAddress(address: string): HexValue {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`Expected 20-byte hex address, received ${address}`);
  }
  return address as HexValue;
}

export function evmToFallbackAccountHex(address: string): HexValue {
  const normalized = normalizeHexAddress(address).slice(2).toLowerCase();
  return `0x${normalized}${"ee".repeat(12)}` as HexValue;
}

export function fallbackAccountHexToSs58(accountHex: string) {
  return encodeAddress(hexToU8a(accountHex), 0);
}

export function buildProbePvmIdentity(evmAddress: string): ProbePvmIdentity {
  const normalized = normalizeHexAddress(evmAddress);
  const fallbackAccountHex = evmToFallbackAccountHex(normalized);
  return {
    evmAddress: normalized,
    fallbackAccountHex,
    paseoSs58: fallbackAccountHexToSs58(fallbackAccountHex),
  };
}

export async function createPvmApi(wssUrl = POLKADOT_HUB_TESTNET_WSS_URL) {
  const api = await ApiPromise.create({ provider: new WsProvider(wssUrl) });
  await api.isReady;
  return api;
}

export async function createEthereumSigner(privateKey: string) {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: "ethereum" });
  return keyring.addFromUri(privateKey);
}

export function defaultPvmWeight(api: any) {
  const maxBlock = api.consts.system.blockWeights.maxBlock;
  return {
    refTime: (BigInt(maxBlock.refTime.toString()) * 64n) / 100n,
    proofSize: (BigInt(maxBlock.proofSize.toString()) * 64n) / 100n,
  };
}

export function normalizeWeight(weight: any) {
  if (!weight) {
    return { refTime: 0n, proofSize: 0n };
  }

  return {
    refTime: BigInt(weight.refTime?.toString?.() ?? weight.refTime ?? 0),
    proofSize: BigInt(weight.proofSize?.toString?.() ?? weight.proofSize ?? 0),
  };
}

export function compactBytecode(bytecode: string) {
  return compactAddLength(hexToU8a(bytecode));
}

export function formatPasFromWei(wei: bigint) {
  return formatUnits(wei, 18);
}

export function decodeDispatchError(api: any, dispatchError: any) {
  if (dispatchError?.isModule) {
    const decoded = api.registry.findMetaError(dispatchError.asModule);
    return `${decoded.section}.${decoded.name}: ${decoded.docs.join(" ")}`;
  }

  return dispatchError?.toString?.() ?? String(dispatchError);
}

export function decodeDryRunError(api: any, dryRun: any) {
  if (dryRun.result?.isErr) {
    return decodeDispatchError(api, dryRun.result.asErr);
  }

  const flags = dryRun.result?.asOk?.result?.flags;
  const flagBits = flags?.bits?.toString?.() ?? flags?.toString?.() ?? "0";
  if (flagBits !== "0") {
    return `Contract execution reverted with flags=${flagBits}`;
  }

  return null;
}

export async function readFallbackAccountBalance(api: any, accountHex: string) {
  const account = await api.query.system.account(accountHex);
  return BigInt(account.data.free.toString());
}

export async function readContractCodeHash(api: any, address: HexValue): Promise<HexValue | undefined> {
  const info = await api.query.revive.accountInfoOf(address);
  if (!info.isSome) {
    return undefined;
  }

  const json = info.unwrap().toJSON() as {
    accountType?: {
      contract?: {
        codeHash?: string;
      };
    };
  };
  const codeHash = json.accountType?.contract?.codeHash;
  return typeof codeHash === "string" ? (codeHash as HexValue) : undefined;
}

export function findInstantiatedAddress(api: any, events: any[]): HexValue | undefined {
  for (const record of events) {
    if (api.events.revive.Instantiated.is(record.event)) {
      return record.event.data[1].toString() as HexValue;
    }
  }

  return undefined;
}

export async function signAndSendFinalized(api: any, tx: any, pair: any, label: string): Promise<PvmFinalizedTx> {
  return await new Promise<PvmFinalizedTx>((resolve, reject) => {
    let unsub: (() => void) | undefined;

    const finish = (handler: () => void) => {
      if (unsub) {
        unsub();
      }
      handler();
    };

    void tx
      .signAndSend(pair, (result: any) => {
        if (result.dispatchError) {
          finish(() => reject(new Error(`${label} failed: ${decodeDispatchError(api, result.dispatchError)}`)));
          return;
        }

        if (result.status?.isFinalized) {
          const txHash = (result.txHash?.toHex?.() ?? tx.hash?.toHex?.() ?? tx.hash?.toString?.()) as HexValue;
          finish(() =>
            resolve({
              txHash,
              blockHash: result.status.asFinalized.toHex() as HexValue,
              events: result.events,
            }),
          );
        }
      })
      .then((nextUnsub: () => void) => {
        unsub = nextUnsub;
      })
      .catch((error: unknown) => {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      });
  });
}
