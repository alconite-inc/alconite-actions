# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| 1.x | Migration fixes only |

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting feature for this repository. If that is unavailable, email `contact@alconite.com` with the subject `Security report: alconite-actions` and include the affected action, version or commit, impact, and reproduction details.

Do not include live project tokens, registry credentials, customer contracts, or other secrets. Revoke any token that may have been exposed during testing.

## Security expectations for consumers

- Pin this action to a full release commit SHA in sensitive workflows.
- Do not make Contract Guard or package-registry secrets available to untrusted fork code.
- Keep publish jobs separate from pull request build jobs.
- Grant `GITHUB_TOKEN` only the permissions required by each job.
- Treat uploaded API contracts as product data and review their contents before sending them to the service.
- Run Impact only on a supported Linux runner, grant its project token only `impact:write` for exact-check workflows, and upload the private report only when repository artifact access and retention are appropriate.
- Treat source submitted to Impact as sensitive. The Action must never execute it or expose source contents, tokens, absolute paths, request bodies, or complete reports in logs and job summaries.
- Supply Runtime Verify target credentials only through explicitly named runner environment variables; never place them in Action inputs or checked-in configuration values.
- Run Runtime Verify only in trusted post-deployment jobs. The target API is called from the customer runner, not from Alconite.
- Keep redirects disabled unless the target requires same-origin redirects, and do not expose deployment secrets to untrusted fork workflows.

Runtime Verify submits bounded status, media-type, timing, size, hash, and finding metadata. It must not submit the target origin, expanded URLs, target request/response header values, response bodies, environment values, local paths, GitHub tokens, or runner diagnostic dumps. Reports that violate this boundary are security issues and should be reported privately.

Impact submits a bounded UTF-8 manifest from the checked-out workspace to the configured Alconite origin and receives an ephemeral deterministic report. It rejects links, path escapes, binaries, unsupported platforms, and resource-limit overflows before publishing a partial result. Source-content or project-token disclosure is a security issue and should be reported privately.
