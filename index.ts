// Supabase Database Webhook handler. Secrets are configured in Supabase Edge Functions.
// - consumables 테이블 변경 → 재고 부족으로 처음 내려갈 때 알림
// - reorder_requests 테이블 INSERT → 구매요청이 들어오면 즉시 알림
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ALERT_EMAIL = Deno.env.get("LABSTOCK_ALERT_EMAIL") ?? "";
const WEBHOOK_SECRET = Deno.env.get("LABSTOCK_WEBHOOK_SECRET") ?? "";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "LabStock <onboarding@resend.dev>";
// Edge Function 런타임이 자동으로 제공하는 값 (구매요청의 품목 정보를 서버에서 조회할 때 사용)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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

  if (payload?.table === "reorder_requests") {
    if (payload?.type !== "INSERT") return json({ skipped: true, reason: "only new requests are mailed" });
    return await sendReorderMail(record);
  }
  return await sendLowStockMail(record, old);
});

async function sendReorderMail(record: any): Promise<Response> {
  const item = await fetchConsumable(record.consumable_id);
  const itemName = String(item?.name ?? "소모품");
  const unit = String(item?.unit ?? "개");
  const location = String(item?.location ?? "위치 미등록");
  const qty = Number(record.requested_quantity ?? 0);
  const requester = String(record.requester ?? "");
  const note = String(record.note ?? "");
  const stock = item ? `${Number(item.quantity)} ${unit} (최소 보유량 ${Number(item.min_quantity)} ${unit})` : "확인 불가";

  const subject = `[LabStock 구매요청] ${itemName} ${qty}${unit} - ${requester}`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#17233b"><h2>LabStock 구매요청</h2><p><b>${escapeHtml(requester)}</b>님이 구매를 요청했습니다.</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse"><tr><td>품목</td><td><b>${escapeHtml(itemName)}</b></td></tr><tr><td>요청 수량</td><td><b>${qty} ${escapeHtml(unit)}</b></td></tr><tr><td>현재 재고</td><td>${escapeHtml(stock)}</td></tr><tr><td>보관 위치</td><td>${escapeHtml(location)}</td></tr><tr><td>요청자</td><td>${escapeHtml(requester)}</td></tr><tr><td>메모</td><td>${escapeHtml(note || "—")}</td></tr></table><p>LabStock에서 요청 상태를 '주문 진행 중' → '입고 완료'로 갱신해 주세요.</p></div>`;
  return await sendMail(subject, html);
}

async function sendLowStockMail(record: any, old: any): Promise<Response> {
  const quantity = Number(record.quantity ?? 0);
  const minimum = Number(record.min_quantity ?? 0);
  const isLow = quantity <= minimum;
  const wasLow = old ? Number(old.quantity ?? 0) <= Number(old.min_quantity ?? 0) : false;
  // Notify on insert if already low, and only on transition from healthy to low afterwards.
  if (!isLow || (old && wasLow)) return json({ skipped: true, reason: "not a new low-stock transition" });

  const itemName = String(record.name ?? "소모품");
  const unit = String(record.unit ?? "개");
  const location = String(record.location ?? "위치 미등록");
  const note = String(record.note ?? "");
  const subject = `[LabStock 재고 부족] ${itemName} (${quantity} ${unit})`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.7;color:#17233b"><h2>LabStock 소모품 재고 부족 알림</h2><p><b>${escapeHtml(itemName)}</b> 품목의 재고가 최소 보유량 이하입니다.</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse"><tr><td>현재 재고</td><td><b>${quantity} ${escapeHtml(unit)}</b></td></tr><tr><td>최소 보유량</td><td>${minimum} ${escapeHtml(unit)}</td></tr><tr><td>보관 위치</td><td>${escapeHtml(location)}</td></tr><tr><td>비고</td><td>${escapeHtml(note || "—")}</td></tr></table><p>LabStock에서 재고를 확인하고 재주문을 진행해 주세요.</p></div>`;
  return await sendMail(subject, html);
}

async function fetchConsumable(id: string): Promise<any | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !id) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/consumables?id=eq.${encodeURIComponent(id)}&select=name,unit,quantity,min_quantity,location`;
    const res = await fetch(url, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] ?? null;
  } catch { return null; }
}

async function sendMail(subject: string, html: string): Promise<Response> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [ALERT_EMAIL], subject, html }),
  });
  if (!response.ok) return new Response(await response.text(), { status: 502 });
  return json({ sent: true });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
