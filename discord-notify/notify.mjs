const webhook = process.env.DISCORD_WEBHOOK_URL || '';
const status = process.env.JOB_STATUS || '';
const releaseVersion = process.env.RELEASE_VERSION || '';

if (!['success', 'failure', 'cancelled'].includes(status)) {
  throw new Error('job-status must be success, failure, or cancelled');
}

const url = new URL(webhook);
if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname)) {
  throw new Error('webhook-url must be an HTTPS Discord webhook URL');
}
if (!url.pathname.startsWith('/api/webhooks/')) throw new Error('webhook-url must identify a Discord webhook');

const presentation = {
  success: { icon: '✅', label: 'succeeded', color: 3066993 },
  failure: { icon: '❌', label: 'failed', color: 15158332 },
  cancelled: { icon: '⚠️', label: 'was cancelled', color: 15844367 },
}[status];

const repository = process.env.GITHUB_REPOSITORY || 'unknown repository';
const refName = process.env.GITHUB_REF_NAME || 'unknown ref';
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const runUrl = `${serverUrl}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID || ''}`;
const release = releaseVersion ? ` ${releaseVersion}` : '';
const payload = {
  username: 'Alconite Bot',
  allowed_mentions: { parse: [] },
  embeds: [
    {
      title: `${presentation.icon} Workflow ${presentation.label}: ${repository}${release}`.slice(0, 256),
      color: presentation.color,
      url: runUrl,
      description: `**Ref:** \`${refName.replaceAll('`', '')}\`\n**Actor:** \`${(process.env.GITHUB_ACTOR || 'unknown').replaceAll('`', '')}\`\n**Run:** [View workflow run](${runUrl})`.slice(0, 4096),
    },
  ],
};

const response = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'alconite-actions/2.2.0' },
  body: JSON.stringify(payload),
  redirect: 'manual',
  signal: AbortSignal.timeout(15_000),
});

if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
