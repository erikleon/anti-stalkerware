/**
 * Single registration point for every IPC handler the renderer can call.
 * Handlers that reach OSINT code must be registered through `registerGated`,
 * never `registerHandler` directly — the security test suite enumerates
 * every handler registered here and asserts each OSINT-reaching one went
 * through the gate. Adding a new OSINT entry point without using
 * `registerGated` is exactly the kind of change that test exists to catch.
 */
import type { VaultStore } from "../vault/store";
import { canUnlockOsint } from "../osint/unlock";

export type IpcHandler<Args extends unknown[] = unknown[], Result = unknown> = (...args: Args) => Promise<Result>;

interface RegisteredHandler {
  channel: string;
  gated: boolean;
}

const registry: RegisteredHandler[] = [];

export function registerHandler<Args extends unknown[], Result>(
  channel: string,
  handler: IpcHandler<Args, Result>,
): IpcHandler<Args, Result> {
  registry.push({ channel, gated: false });
  return handler;
}

export function registerGated<Args extends unknown[], Result>(
  channel: string,
  sender: (...args: Args) => string,
  getVault: () => VaultStore | undefined,
  handler: IpcHandler<Args, Result>,
): IpcHandler<Args, Result> {
  registry.push({ channel, gated: true });
  return async (...args: Args) => {
    // A vault-getter, not a fixed instance: the real app registers every
    // IPC channel once at startup, but which vault (if any) is open
    // changes as the user locks/unlocks — this must always check the
    // current one, never one captured at registration time. No vault open
    // collapses to the same refusal as an ineligible sender; neither case
    // gets a more specific message.
    const vault = getVault();
    const allowed = vault !== undefined && (await canUnlockOsint(sender(...args), vault));
    if (!allowed) {
      throw new Error("OSINT lookup refused: sender is not a flagged vault contact.");
    }
    return handler(...args);
  };
}

/** Used by the security test suite to confirm every OSINT channel is gated. */
export function listRegisteredHandlers(): readonly RegisteredHandler[] {
  return registry;
}
