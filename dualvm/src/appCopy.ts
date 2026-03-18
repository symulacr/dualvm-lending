export const DEFAULT_OBSERVER_ADDRESS = "0x31FA19B35fdBD96f381A0be838799ca40978D080";

export function humanizeReadError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("429") || normalized.includes("rate")) {
    return "Public RPC rate-limited the request. Wait a few seconds and refresh.";
  }
  if (normalized.includes("fetch") || normalized.includes("network") || normalized.includes("timeout")) {
    return "Public RPC did not answer cleanly. Refresh to retry.";
  }
  return message;
}
