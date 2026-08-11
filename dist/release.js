"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNTIME_VERIFY_RUNNER = exports.RUNTIME_VERIFY_USER_AGENT = exports.IMPACT_USER_AGENT = exports.CONTRACT_GUARD_USER_AGENT = exports.ACTION_RELEASE_VERSION = void 0;
/** The repository-wide Action release carried by the current tag. */
exports.ACTION_RELEASE_VERSION = '2.2.0';
/** Stable outbound identity for the Contract Guard component. */
exports.CONTRACT_GUARD_USER_AGENT = `alconite-contract-guard-action/${exports.ACTION_RELEASE_VERSION}`;
/** Stable outbound identity for the Impact component. */
exports.IMPACT_USER_AGENT = `alconite-impact-action/${exports.ACTION_RELEASE_VERSION}`;
/** Stable outbound identity for the Runtime Verify component. */
exports.RUNTIME_VERIFY_USER_AGENT = `alconite-runtime-verify-action/${exports.ACTION_RELEASE_VERSION}`;
/** Stable runner identity submitted with Runtime Verify observations. */
exports.RUNTIME_VERIFY_RUNNER = {
    name: 'alconite-runtime-verify-action',
    version: exports.ACTION_RELEASE_VERSION,
};
//# sourceMappingURL=release.js.map