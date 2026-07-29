import type { Account } from "@/types";
import {
  CAPABILITY_DEPENDENCIES,
  GUEST_CAPABILITIES,
  OWNER_CAPABILITIES,
  type Capability,
  type GuestCapability,
} from "@/lib/validation/constants";

const GUEST_SET = new Set<string>(GUEST_CAPABILITIES);
const OWNER_SET = new Set<string>(OWNER_CAPABILITIES);

export function isGuestCapability(cap: string): cap is GuestCapability {
  return GUEST_SET.has(cap);
}

/** Owners implicitly hold every capability; guests only their assigned set. */
export function hasCapability(account: Account | null, capability: Capability): boolean {
  if (!account || account.disabledAt !== null) return false;
  if (account.type === "owner") return true;
  return account.capabilities.includes(capability as GuestCapability);
}

/**
 * Validate and normalize a requested guest capability set:
 * - only guest-assignable capabilities are kept (owner-only ones are rejected)
 * - the result must be closed under CAPABILITY_DEPENDENCIES
 * Returns an error message when invalid, null when acceptable.
 */
export function validateCapabilityAssignment(requested: string[]): string | null {
  if (requested.length > GUEST_CAPABILITIES.length) return "Too many capabilities requested";
  for (const cap of requested) {
    if (OWNER_SET.has(cap)) return `Capability "${cap}" is owner-only and cannot be assigned`;
    if (!isGuestCapability(cap)) return `Unknown capability "${cap}"`;
  }
  const set = new Set(requested);
  for (const cap of requested) {
    const deps = CAPABILITY_DEPENDENCIES[cap as Capability] ?? [];
    for (const dep of deps) {
      if (!set.has(dep)) {
        return `Capability "${cap}" requires "${dep}"`;
      }
    }
  }
  return null;
}

/** Normalized, deduplicated capability list after validation. */
export function normalizeCapabilities(requested: string[]): GuestCapability[] {
  const error = validateCapabilityAssignment(requested);
  if (error) throw new Error(error);
  return [...new Set(requested)].filter(isGuestCapability);
}
