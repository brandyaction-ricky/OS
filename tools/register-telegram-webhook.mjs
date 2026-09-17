const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const publicUrl = (process.env.OS_PUBLIC_URL ?? "").trim().replace(/\/$/, "");
const environment = process.env.OS_ENVIRONMENT?.trim();
const confirmed = process.argv.includes("--confirm");

if (!confirmed) {
  console.error("[telegram] registration blocked: pass --confirm after verifying the target environment");
  process.exit(2);
}

if (!["development", "qa", "production"].includes(environment)) {
  console.error("[telegram] registration blocked: OS_ENVIRONMENT must be development, qa, or production");
  process.exit(2);
}

if (!token || !secret || !publicUrl) {
  console.error("[telegram] registration blocked: configuration is incomplete");
  process.exit(2);
}

const webhookUrl = `${publicUrl}/api/v1/telegram/webhook`;
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  }),
  signal: AbortSignal.timeout(15_000),
});

const result = await response.json().catch(() => ({}));
if (!response.ok || result.ok !== true) {
  throw new Error(`[telegram] webhook registration failed: ${result.description ?? response.status}`);
}

console.log(`[telegram] ${environment} webhook registered: ${webhookUrl}`);
