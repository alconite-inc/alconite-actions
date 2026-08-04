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
