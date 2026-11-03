import { createClient } from "npm:@supabase/supabase-js@2.57.4";

/*
 * Bird WhatsApp delivery-status webhook receiver.
 *
 * Bird follows the Standard Webhooks specification:
 *   - Headers: webhook-id, webhook-timestamp, webhook-signature
 *   - Signature: HMAC-SHA256 over `{id}.{timestamp}.{rawBody}`, keyed with the
 *     base64-decoded endpoint secret (strip the `whsec_` prefix).
 *   - Dedup on webhook-id (at-least-once delivery).
 *
 * Event types we handle:
 *   whatsapp.accepted  → status = 'accepted'
 *   whatsapp.sent      → status = 'sent'
 *   whatsapp.delivered → status = 'delivered'
 *   whatsapp.read      → status = 'read'
 *   whatsapp.failed    → status = 'failed' + error fields → create delivery_alert + notify agent
 *   whatsapp.rejected  → status = 'rejected' + error fields → create delivery_alert + notify agent
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const birdApiKey = Deno.env.get("BIRD_API_KEY");
const birdFromNumber = Deno.env.get("BIRD_FROM_NUMBER");
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const birdWebhookSecret = Deno.env.get("BIRD_WEBHOOK_SECRET");

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- Signature verification (Standard Webhooks) ---------------------------

async function verifySignature(
  rawBody: Uint8Array,
  headers: Headers,
): Promise<boolean> {
  if (!birdWebhookSecret) {
    console.error("BIRD_WEBHOOK_SECRET is not configured");
    return false;
  }

  const webhookId = headers.get("webhook-id");
  const webhookTimestamp = headers.get("webhook-timestamp");
  const webhookSignature = headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return false;
  }

  // Reject timestamps older than 5 minutes
  const ageMs = Date.now() - parseInt(webhookTimestamp, 10) * 1000;
  if (isNaN(ageMs) || Math.abs(ageMs) > 5 * 60 * 1000) {
    console.error("Webhook timestamp out of range");
    return false;
  }

  // Strip whsec_ prefix and base64-decode to get key bytes
  let secret = birdWebhookSecret;
  if (secret.startsWith("whsec_")) {
    secret = secret.slice(6);
  }

  const keyBytes = base64ToBytes(secret);
  const message = new TextEncoder().encode(
    `${webhookId}.${webhookTimestamp}.`,
  );
  const combined = new Uint8Array(message.length + rawBody.length);
  combined.set(message, 0);
  combined.set(rawBody, message.length);

  const expectedSig = await hmacSha256Base64(keyBytes, combined);

  // During secret rotation, the header can contain multiple space-separated signatures
  // Each is prefixed with "v1,"
  return webhookSignature.split(" ").some((part) => {
    const sig = part.replace(/^v1,/, "");
    return timingSafeEqualBase64(sig, expectedSig);
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function hmacSha256Base64(key: Uint8Array, data: Uint8Array): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
  return bytesToBase64(new Uint8Array(sig));
}

function timingSafeEqualBase64(a: string, b: string): boolean {
  const aBytes = base64ToBytes(a);
  const bBytes = base64ToBytes(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

// --- Event processing ------------------------------------------------------

interface BirdWebhookPayload {
  type: string;
  timestamp: string;
  data: {
    direction?: string;
    from?: { phone_number?: string };
    to?: { phone_number?: string };
    whatsapp_id?: string;
    metadata?: Record<string, unknown> | null;
    tags?: { name: string; value: string }[] | null;
    workspace_id?: string;
    error?: {
      code: string;
      description: string;
      meta_error_code?: string;
      occurred_at?: string;
    };
  };
}

const FAILURE_TYPES = new Set(["whatsapp.failed", "whatsapp.rejected"]);
const STATUS_MAP: Record<string, string> = {
  "whatsapp.accepted": "accepted",
  "whatsapp.sent": "sent",
  "whatsapp.delivered": "delivered",
  "whatsapp.read": "read",
  "whatsapp.failed": "failed",
  "whatsapp.rejected": "rejected",
};

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

function formatDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

async function notifyAgentOfFailure(
  attempt: {
    id: string;
    appointment_id: string;
    recipient_address: string;
    error_code: string | null;
    error_description: string | null;
  },
): Promise<{ status: string }> {
  // Fetch appointment and agent profile
  const { data: appt } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", attempt.appointment_id)
    .maybeSingle();

  if (!appt) return { status: "skipped" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone")
    .eq("id", appt.assigned_to)
    .maybeSingle();

  if (!profile) return { status: "skipped" };

  const customerName = appt.client_name || "Client";
  const customerPhone = appt.client_phone || "N/A";
  const apptDate = formatDate(appt.appointment_date);
  const apptTime = formatTime(appt.start_time);
  const failureReason = attempt.error_description || attempt.error_code || "Unknown error";

  // Prefer email via Resend (no WhatsApp template restriction outside customer service window)
  if (profile.email && resendApiKey) {
    const subject = `WhatsApp Reminder Delivery Failure – ${customerName}`;
    const body = [
      `Hi ${profile.full_name},`,
      "",
      `A WhatsApp appointment reminder to your customer could not be delivered.`,
      "",
      `Customer: ${customerName}`,
      `Customer Phone: ${customerPhone}`,
      `Appointment: ${apptDate} at ${apptTime}`,
      `Failure Reason: ${failureReason}`,
      "",
      "Please contact the customer directly to confirm their appointment.",
      "",
      "This is an automated notification.",
    ].join("\n");

    const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#dc2626;">WhatsApp Reminder Delivery Failure</h2>
<p>Hi ${profile.full_name},</p>
<p>A WhatsApp appointment reminder to your customer could not be delivered.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;">
<tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600;">Customer</td><td style="padding:8px;border:1px solid #e2e8f0;">${customerName}</td></tr>
<tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600;">Customer Phone</td><td style="padding:8px;border:1px solid #e2e8f0;">${customerPhone}</td></tr>
<tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600;">Appointment</td><td style="padding:8px;border:1px solid #e2e8f0;">${apptDate} at ${apptTime}</td></tr>
<tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600;">Failure Reason</td><td style="padding:8px;border:1px solid #e2e8f0;color:#dc2626;">${failureReason}</td></tr>
</table>
<p style="font-size:16px;font-weight:600;color:#dc2626;">Please contact the customer directly to confirm their appointment.</p>
<p style="color:#64748b;font-size:13px;">This is an automated notification.</p>
</div>`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "notifications@stressfreetaxes.com",
          to: profile.email,
          subject,
          text: body,
          html,
        }),
      });
      if (res.ok) return { status: "sent" };
      const errText = await res.text();
      console.error("Resend agent notification failed:", errText);
      return { status: "failed" };
    } catch (err) {
      console.error("Agent notification email error:", err);
      return { status: "failed" };
    }
  }

  return { status: "skipped" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Capture raw body for signature verification
    const rawBodyArray = new Uint8Array(await req.arrayBuffer());

    // Verify signature
    const isValid = await verifySignature(rawBodyArray, req.headers);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse body
    const bodyText = new TextDecoder().decode(rawBodyArray);
    const payload: BirdWebhookPayload = JSON.parse(bodyText);

    const webhookId = req.headers.get("webhook-id") || "";
    const eventType = payload.type || "";
    const birdMessageId = payload.data?.whatsapp_id || "";

    // Dedup on webhook-id
    const { data: existingEvent } = await supabase
      .from("webhook_events")
      .select("id")
      .eq("webhook_id", webhookId)
      .maybeSingle();

    if (existingEvent) {
      // Already processed — ack and return
      return new Response(JSON.stringify({ status: "duplicate", event_type: eventType }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record the webhook event
    await supabase.from("webhook_events").insert({
      webhook_id: webhookId,
      event_type: eventType,
      bird_message_id: birdMessageId,
    });

    // Find the attempt by Bird message ID
    if (!birdMessageId) {
      return new Response(JSON.stringify({ status: "no_message_id" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: attempt } = await supabase
      .from("reminder_attempts")
      .select("*")
      .eq("bird_message_id", birdMessageId)
      .maybeSingle();

    if (!attempt) {
      // No matching attempt — could be a message sent outside this system
      return new Response(JSON.stringify({ status: "no_attempt_found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newStatus = STATUS_MAP[eventType];
    if (!newStatus) {
      // Unrecognized event type — ignore but ack
      return new Response(JSON.stringify({ status: "ignored", event_type: eventType }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build update for the attempt
    const update: Record<string, unknown> = {
      delivery_status: newStatus,
      status_timestamp: payload.timestamp || new Date().toISOString(),
    };

    // Capture error details for failure/rejected events
    if (FAILURE_TYPES.has(eventType) && payload.data?.error) {
      update.error_code = payload.data.error.code || null;
      update.error_description = payload.data.error.description || null;
      update.error_meta_code = payload.data.error.meta_error_code || null;
    }

    await supabase
      .from("reminder_attempts")
      .update(update)
      .eq("id", attempt.id);

    // For failed/rejected: create a delivery alert + notify agent (if not already notified)
    if (FAILURE_TYPES.has(eventType)) {
      // Check if alert already exists (dedup from duplicate webhooks handled above, but be safe)
      const { data: existingAlert } = await supabase
        .from("delivery_alerts")
        .select("id")
        .eq("attempt_id", attempt.id)
        .maybeSingle();

      if (!existingAlert) {
        await supabase.from("delivery_alerts").insert({
          attempt_id: attempt.id,
        });
      }

      // Notify agent if not already notified
      if (!attempt.agent_notified) {
        const notifResult = await notifyAgentOfFailure({
          id: attempt.id,
          appointment_id: attempt.appointment_id,
          recipient_address: attempt.recipient_address,
          error_code: (update.error_code as string) || attempt.error_code,
          error_description: (update.error_description as string) || attempt.error_description,
        });

        await supabase
          .from("reminder_attempts")
          .update({
            agent_notified: true,
            agent_notification_status: notifResult.status,
          })
          .eq("id", attempt.id);
      }
    }

    // For delivered/read: if this is a retry attempt, mark the parent as resolved
    if (newStatus === "delivered" && attempt.is_retry && attempt.parent_attempt_id) {
      await supabase
        .from("reminder_attempts")
        .update({ resolved_by_retry: true })
        .eq("id", attempt.parent_attempt_id);

      // Mark any alerts on the parent attempt as resolved
      await supabase
        .from("delivery_alerts")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("attempt_id", attempt.parent_attempt_id)
        .eq("resolved", false);
    }

    return new Response(JSON.stringify({ status: "processed", event_type: eventType, delivery_status: newStatus }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
