# Discord Notify

`alconite-inc/alconite-actions/discord-notify@v2.5.0` sends a single workflow status embed to a Discord webhook. It uses the runner's Node HTTP client without another action dependency. Sources: [action.yaml](../../discord-notify/action.yaml) and [notify.mjs](../../discord-notify/notify.mjs).

## Requirements and permissions

Use a Linux runner with Bash and a current Node runtime supporting `fetch` and `AbortSignal.timeout` (Node 24 is recommended alongside the other helpers). Source checkout is unnecessary. The action needs outbound HTTPS access to Discord, a webhook configured for the intended channel, and the webhook URL stored in a GitHub secret such as `DISCORD_WEBHOOK`.

The helper needs no GitHub token permissions. In a notification-only job use `permissions: {}`. A Discord webhook URL is the credential that authorizes posting to its channel; pass it from a secret and avoid printing it in workflow logs. See [shared setup](README.md).

## Inputs and outputs

| Input | Required | Default | Meaning |
| --- | --- | --- | --- |
| `webhook-url` | **Yes** | none | HTTPS webhook under `discord.com/api/webhooks/` or `discordapp.com/api/webhooks/`. Other hosts and paths are rejected. |
| `job-status` | **Yes** | none | Exactly `success`, `failure`, or `cancelled`; determines embed label, icon, and color. |
| `release-version` | No | empty | Optional release text appended to the embed title. |

There are no action outputs.

The embed includes the repository, optional release, ref, actor, and a link to the GitHub workflow run. The title is limited to 256 characters and the description to 4,096 characters. Discord mentions are disabled through `allowed_mentions`. It does not send test logs, code, or report artifacts.

The request has a 15-second timeout. Redirects are not followed; a non-success HTTP response or network/timeout error fails the action. There is one attempt and no automatic retry. Use workflow `continue-on-error: true` only when a notification delivery failure should not fail the job.

## Example: notify after a job's steps

Append the following step to a build job:

```yaml
- name: Notify Discord
  if: ${{ always() }}
  uses: alconite-inc/alconite-actions/discord-notify@v2.5.0
  with:
    webhook-url: ${{ secrets.DISCORD_WEBHOOK }}
    job-status: ${{ job.status }}
```

`job.status` represents the current job, not every job in a workflow. For a separate job that summarizes several dependencies, compute status from `needs`:

```yaml
notify:
  needs: [test, publish] # Existing job IDs in your workflow.
  if: ${{ always() }}
  runs-on: ubuntu-24.04
  permissions: {}
  env:
    DISCORD_WEBHOOK: ${{ secrets.DISCORD_WEBHOOK }}
  steps:
    - name: Send workflow result
      if: ${{ env.DISCORD_WEBHOOK != '' }}
      uses: alconite-inc/alconite-actions/discord-notify@v2.5.0
      with:
        webhook-url: ${{ env.DISCORD_WEBHOOK }}
        job-status: ${{ contains(needs.*.result, 'failure') && 'failure' || contains(needs.*.result, 'cancelled') && 'cancelled' || 'success' }}
```

This expression prioritizes failure, then cancellation, then success; skipped jobs alone do not make it a failure. The explicit environment guard skips sending when the secret is unavailable, including normal fork PR runs.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Invalid URL/webhook error | Ensure the secret holds a full HTTPS Discord webhook URL, not a channel URL. |
| Invalid status | Use `job.status` in a step or the aggregate expression above. `skipped` is not an accepted input. |
| HTTP 401/403/404 | Verify the webhook still exists and its credential/path are correct. Recreate a revoked webhook and update the secret. |
| HTTP 429 or timeout | Check Discord rate limiting and runner network access. This helper does not retry automatically. |
| No notification after cancellation | GitHub can terminate runners before cleanup steps complete; `always()` does not guarantee delivery after hard cancellation. |
