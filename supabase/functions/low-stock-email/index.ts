// Supabase Database Webhook handler. Secrets are configured in Supabase Edge Functions.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ALERT_EMAIL = Deno.env.get("LABSTOCK_ALERT_EMAIL") ?? "";
const WEBHOOK_SECRET = Deno.env.get("LABSTOCK_WEBHOOK_SECRET") ?? "";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "LabStock <onboarding@resend.dev>";

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!WEBHOOK_SECRET || req.headers.get("x-labstock-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!RESEND_API_KEY || !ALERT_EMAIL) return new Response("Email secrets are not configured", { status: 500 });

  let payload: any;
  try { payload = await req.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const record = payload?.record;
  const old = payload?.old_record;
  if (!record || !record.id) return new Response("No record", { status: 400 });

  const quantity = Number(record.quantity ?? 0);
  const minimum = Number(record.min_quantity ?? 0);
  const isLow = quantity <= minimum;
  const wasLow = old ? Number(old.quantity ?? 0) <= Number(old.min_quantity ?? 0) : false;
  // Notify on insert if already low, and only on transition from healthy to low afterwards.
  if (!isLow || (old && wasLow)) return new Response(JSON.stringify({ skipped: true, reason: "not a new low-stock transition" }), { headers: { "content-type": "application/json" } });

  const itemName = String(record.name ?? "소모품");
  const unit = String(record.unit ?? "개");
  const location = String(record.location ?? "위치 미등록");
  const note = String(record.note ?? "");
  const subject = `[LabStock 재고 부족] ${itemName} (${quantity} ${unit})`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#17233b"><h2>LabStock 소모품 재고 부족 알림</h2><p><b>${escapeHtml(itemName)}</b> 품목의 재고가 최소 보유량 이하입니다.</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse"><tr><td>현재 재고</td><td><b>${quantity} ${escapeHtml(unit)}</b></td></tr><tr><td>최소 보유량</td><td>${minimum} ${escapeHtml(unit)}</td></tr><tr><td>보관 위치</td><td>${escapeHtml(location)}</td></tr><tr><td>비고</td><td>${escapeHtml(note || "—")}</td></tr></table><p>LabStock에서 재고를 확인하고 재주문을 진행해 주세요.</p></div>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [ALERT_EMAIL], subject, html }),
  });
  if (!response.ok) return new Response(await response.text(), { status: 502 });
  return new Response(JSON.stringify({ sent: true }), { headers: { "content-type": "application/json" } });
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
