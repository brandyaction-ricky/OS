const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const publicUrl = (process.env.OS_PUBLIC_URL ?? "").trim().replace(/\/$/, "");

if (!token || !secret || !publicUrl) {
  console.log("[telegram] webhook registration skipped: configuration is incomplete");
  process.exit(0);
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

console.log(`[telegram] webhook registered: ${webhookUrl}`);
