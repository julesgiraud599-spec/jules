import { db } from "./db";

export async function notify(userId: string, title: string, body: string, link?: string) {
  await db.notification.create({ data: { userId, title, body, link } });
  const user = await db.user.findUnique({ where: { id: userId }, select: { webhookUrl: true } });
  if (!user?.webhookUrl) return;
  const url = (process.env.APP_URL ?? "") + (link ?? "");
  const text = `**${title}**\n${body}${link ? `\n${url}` : ""}`;
  try {
    const u = new URL(user.webhookUrl);
    const isNtfy = u.hostname.includes("ntfy");
    await fetch(user.webhookUrl, isNtfy
      ? { method: "POST", body: `${body}${link ? `\n${url}` : ""}`, headers: { Title: title } }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text, text }) });
  } catch (e) {
    console.error("Webhook de notification en échec :", e);
  }
}
