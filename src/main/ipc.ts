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
  vault: VaultStore,
  handler: IpcHandler<Args, Result>,
): IpcHandler<Args, Result> {
  registry.push({ channel, gated: true });
  return async (...args: Args) => {
    const allowed = await canUnlockOsint(sender(...args), vault);
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
