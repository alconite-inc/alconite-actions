/** The repository-wide Action release carried by the current tag. */
export const ACTION_RELEASE_VERSION = '2.2.0';

/** Stable outbound identity for the Contract Guard component. */
export const CONTRACT_GUARD_USER_AGENT = `alconite-contract-guard-action/${ACTION_RELEASE_VERSION}`;

/** Stable outbound identity for the Impact component. */
export const IMPACT_USER_AGENT = `alconite-impact-action/${ACTION_RELEASE_VERSION}`;

/** Stable outbound identity for the Runtime Verify component. */
export const RUNTIME_VERIFY_USER_AGENT = `alconite-runtime-verify-action/${ACTION_RELEASE_VERSION}`;

/** Stable runner identity submitted with Runtime Verify observations. */
export const RUNTIME_VERIFY_RUNNER = {
  name: 'alconite-runtime-verify-action',
  version: ACTION_RELEASE_VERSION,
} as const;
