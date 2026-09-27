const token = process.env.INSTAGRAM_TOPICS_TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.INSTAGRAM_TOPICS_TELEGRAM_WEBHOOK_SECRET?.trim();
const publicUrl = process.env.OS_PUBLIC_URL?.trim().replace(/\/$/, "");
const environment = process.env.OS_ENVIRONMENT?.trim();

if (!process.argv.includes("--confirm") || !["development", "qa", "production"].includes(environment)) {
  console.error("[instagram-topics] specify OS_ENVIRONMENT=development|qa|production and --confirm");
  process.exit(2);
}
if (!token || !secret || !publicUrl || !publicUrl.startsWith("https://")) {
  console.error("[instagram-topics] bot token, webhook secret, and HTTPS OS_PUBLIC_URL are required");
  process.exit(2);
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) throw new Error(`[instagram-topics] ${method} failed (HTTP ${response.status})`);
  return result.result;
}

const bot = await telegram("getMe", {});
if (bot?.username !== "brandyaction_ig_topics_bot") {
  throw new Error("[instagram-topics] token belongs to a different bot; no webhook was changed");
}
const webhookUrl = `${publicUrl}/api/v1/telegram/instagram-topics`;
await telegram("setWebhook", { url: webhookUrl, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: false });
console.log(`[instagram-topics] ${environment} webhook registered for @${bot.username}: ${webhookUrl}`);
