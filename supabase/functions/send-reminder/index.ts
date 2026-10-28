import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const birdApiKey = Deno.env.get("BIRD_API_KEY");
const birdFromNumber = Deno.env.get("BIRD_FROM_NUMBER");

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface ReminderRow {
  id: string;
  appointment_id: string;
  recipient_type: "coworker" | "client";
  recipient_address: string;
  scheduled_send_at: string;
  status: string;
  retry_count: number;
}

interface AppointmentRow {
  id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  appointment_type: string;
  client_name: string;
  client_phone: string;
  client_email: string;
  notes: string;
  assigned_to: string;
  company_snapshot: {
    name: string;
    address_line1: string;
    address_line2: string;
    city: string;
    state: string;
    zip_code: string;
    phone: string | null;
  } | null;
}

interface ProfileRow {
  full_name: string;
  email: string;
}

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

function formatDateShort(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Check if an error string indicates an out-of-funds or registration restriction
function isBillingOrRestrictionError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("insufficient") ||
    lower.includes("out of funds") ||
    lower.includes("balance") ||
    lower.includes("quota") ||
    lower.includes("registration") ||
    lower.includes("not registered") ||
    lower.includes("unverified") ||
    lower.includes("trial") ||
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("403") ||
    lower.includes("402")
  );
}

// Build the dynamic template variables for the client SMS
function buildClientSMS(appt: AppointmentRow, profile: ProfileRow) {
  return {
    clientName: appt.client_name || "Client",
    appointmentDate: formatDateShort(appt.appointment_date),
    appointmentTime: formatTime(appt.start_time),
  };
}

async function sendBirdSMS(toPhone: string, templateData: any, birdApiKey: string) {
  try {
    if (!birdFromNumber) {
      return { success: false, error: "BIRD_FROM_NUMBER is not configured in edge function secrets." };
    }
    const e164Pattern = /^\+?[1-9]\d{1,14}$/;
    const normalizedFrom = birdFromNumber.startsWith("+") ? birdFromNumber : `+${birdFromNumber}`;
    if (!e164Pattern.test(normalizedFrom)) {
      return { success: false, error: `BIRD_FROM_NUMBER is not in E.164 format: ${birdFromNumber}` };
    }

    const cleanNumber = toPhone.replace(/\D/g, "");
    const formattedTo = cleanNumber.startsWith("1") ? `+${cleanNumber}` : `+1${cleanNumber}`;

    const res = await fetch("https://us1.platform.bird.com/v1/whatsapp/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${birdApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: normalizedFrom,
        to: formattedTo,
        template: {
          slug: "appointment_reminder_redirect",
          language: "en",
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", name: "first_name", text: templateData.clientName || "Client" },
                { type: "text", name: "appointment_date", text: templateData.appointmentDate },
                { type: "text", name: "appointment_time", text: templateData.appointmentTime }
              ]
            }
          ]
        }
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Bird API error (${res.status}): ${errText}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  html: string,
): Promise<{ success: boolean; error?: string }> {
  if (!resendApiKey) {
    return { success: false, error: "RESEND_API_KEY is not configured in edge function secrets." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "notifications@stressfreetaxes.com",
        to,
        subject,
        text: body,
        html: html,
      }),
    });

    if (!res.ok) {
      let errDetail = "";
      try {
        const errJson = await res.json();
        errDetail = errJson?.message || errJson?.error || JSON.stringify(errJson);
      } catch {
        try {
          errDetail = await res.text();
        } catch {
          errDetail = `HTTP ${res.status}`;
        }
      }
      return { success: false, error: `Resend API error (${res.status}): ${errDetail}` };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error contacting Resend API.",
    };
  }
}

// Dynamic company logo map — keyed by company name from the appointment snapshot.
// Update or add entries here to customize each company's branded logo URL.
const COMPANY_LOGOS: Record<string, string> = {
  "STRESS FREE TAXES": "https://firmdngjvcyhfnhaaafq.supabase.co/storage/v1/object/public/email-assets/stress-free-taxes-logo.png",
  "MB Multiservice, LLC": "https://firmdngjvcyhfnhaaafq.supabase.co/storage/v1/object/public/email-assets/mb-multiservice-logo.png",
};

const DEFAULT_LOGO_URL = "https://firmdngjvcyhfnhaaafq.supabase.co/storage/v1/object/public/email-assets/default-logo.png";

function getCompanyLogo(companyName: string | undefined): string {
  if (!companyName) return DEFAULT_LOGO_URL;
  return COMPANY_LOGOS[companyName] || DEFAULT_LOGO_URL;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailShell(innerContent: string, logoUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Appointment Notification</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;min-height:100vh;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
          <!-- Dynamic Brand Header -->
          <tr>
            <td style="padding:28px 40px 20px;text-align:center;background-color:#ffffff;">
              <img src="${logoUrl}" alt="Company Logo" style="max-height:60px;max-width:260px;height:auto;width:auto;display:inline-block;" />
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;background-color:#ffffff;">
              <div style="height:4px;background:linear-gradient(90deg,#0f766e 0%,#14b8a6 100%);border-radius:2px;"></div>
            </td>
          </tr>
          ${innerContent}
        </table>
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:20px 16px 0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">This is an automated message. Please do not reply directly to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildClientEmail(appt: AppointmentRow, profile: ProfileRow): { subject: string; html: string; body: string } {
  const company = appt.company_snapshot;
  const companyName = company?.name || "Our Office";
  const logoUrl = getCompanyLogo(company?.name);
  const subject = `Appointment Confirmation – ${companyName}`;

  const plainBody = [
    `Hello ${appt.client_name},`,
    "",
    `Your appointment with ${profile.full_name} at ${companyName} is confirmed for ${formatDate(appt.appointment_date)} at ${formatTime(appt.start_time)}.`,
    "",
    `Appointment Type: ${appt.appointment_type}`,
    `Date: ${formatDate(appt.appointment_date)}`,
    `Time: ${formatTime(appt.start_time)} – ${formatTime(appt.end_time)}`,
    `Assigned to: ${profile.full_name}`,
    "",
    company ? `Location:` : "",
    company?.name || "",
    company?.address_line1 || "",
    company?.address_line2 ? company.address_line2 : "",
    company ? `${company.city}, ${company.state} ${company.zip_code}` : "",
    company?.phone ? `Phone: ${company.phone}` : "",
    "",
    "If you need to reschedule or have any questions, please contact us.",
    "",
    `Thank you, and we look forward to seeing you.`,
    `— The team at ${companyName}`,
  ].filter(Boolean).join("\n");

  const addressLines = [
    company?.address_line1,
    company?.address_line2,
    company ? `${company.city}, ${company.state} ${company.zip_code}` : null,
  ].filter(Boolean).map(escapeHtml);

  const innerContent = `
          <!-- Greeting -->
          <tr>
            <td style="padding:36px 40px 8px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#1e293b;line-height:1.3;">Hello ${escapeHtml(appt.client_name)},</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 28px;">
              <p style="margin:0;font-size:15px;color:#475569;line-height:1.6;">Your appointment with <strong style="color:#1e293b;">${escapeHtml(profile.full_name)}</strong> at <strong style="color:#1e293b;">${escapeHtml(companyName)}</strong> is confirmed. Here are the details:</p>
            </td>
          </tr>

          <!-- Appointment Details Card -->
          <tr>
            <td style="padding:0 40px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-bottom:16px;">
                          <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Appointment Type</p>
                          <p style="margin:0;font-size:15px;color:#1e293b;font-weight:500;">${escapeHtml(appt.appointment_type)}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-bottom:16px;border-top:1px solid #e2e8f0;padding-top:16px;">
                          <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Date</p>
                          <p style="margin:0;font-size:15px;color:#1e293b;font-weight:500;">${escapeHtml(formatDate(appt.appointment_date))}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-bottom:16px;border-top:1px solid #e2e8f0;padding-top:16px;">
                          <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Time</p>
                          <p style="margin:0;font-size:15px;color:#1e293b;font-weight:500;">${formatTime(appt.start_time)} – ${formatTime(appt.end_time)}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="border-top:1px solid #e2e8f0;padding-top:16px;">
                          <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Assigned To</p>
                          <p style="margin:0;font-size:15px;color:#1e293b;font-weight:500;">${escapeHtml(profile.full_name)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Reschedule note -->
          <tr>
            <td style="padding:0 40px 32px;">
              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">If you need to reschedule or have any questions, please don't hesitate to reach out to our office.</p>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding:0 40px 32px;">
              <p style="margin:0 0 4px;font-size:15px;color:#1e293b;font-weight:500;">We look forward to seeing you,</p>
              <p style="margin:0;font-size:14px;color:#64748b;">The team at ${escapeHtml(companyName)}</p>
            </td>
          </tr>

          <!-- Dynamic Company Footer -->
          <tr>
            <td style="padding:24px 40px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Office Location</p>
              <p style="margin:0 0 2px;font-size:14px;color:#475569;font-weight:500;">${escapeHtml(companyName)}</p>
              ${addressLines.map(line => `<p style="margin:0 0 2px;font-size:13px;color:#64748b;line-height:1.5;">${line}</p>`).join("")}
              ${company?.phone ? `<p style="margin:6px 0 0;font-size:13px;color:#64748b;">Phone: ${escapeHtml(company.phone)}</p>` : ""}
            </td>
          </tr>`;

  const html = buildEmailShell(innerContent, logoUrl);
  return { subject, html, body: plainBody };
}

function buildCoworkerEmail(appt: AppointmentRow, profile: ProfileRow): { subject: string; html: string; body: string } {
  const company = appt.company_snapshot;
  const companyName = company?.name || "Our Office";
  const logoUrl = getCompanyLogo(company?.name);
  const subject = `Internal Reminder – ${appt.client_name} on ${formatDate(appt.appointment_date)}`;

  const plainBody = [
    `Hi ${profile.full_name},`,
    "",
    `You have an upcoming appointment with ${appt.client_name} on ${formatDate(appt.appointment_date)} at ${formatTime(appt.start_time)}.`,
    "",
    `Appointment type: ${appt.appointment_type}`,
    `Date: ${formatDate(appt.appointment_date)}`,
    `Time: ${formatTime(appt.start_time)} – ${formatTime(appt.end_time)}`,
    "",
    `Client: ${appt.client_name}`,
    `Client phone: ${appt.client_phone}`,
    appt.client_email ? `Client email: ${appt.client_email}` : "",
    "",
    company ? `Company: ${company.name}` : "",
    company ? `Location: ${company.address_line1}, ${company.city}, ${company.state} ${company.zip_code}` : "",
    company?.phone ? `Office phone: ${company.phone}` : "",
    "",
    "Please sign in to the calendar to view or manage this appointment.",
  ].filter(Boolean).join("\n");

  const addressLines = [
    company?.address_line1,
    company?.address_line2,
    company ? `${company.city}, ${company.state} ${company.zip_code}` : null,
  ].filter(Boolean).map(escapeHtml);

  const innerContent = `
          <!-- Internal Heading -->
          <tr>
            <td style="padding:28px 40px 4px;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:600;color:#0f766e;text-transform:uppercase;letter-spacing:0.1em;">Internal Notification</p>
              <h1 style="margin:0;font-size:20px;font-weight:700;color:#1e293b;line-height:1.3;">Upcoming Appointment Reminder</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 28px;">
              <p style="margin:0;font-size:15px;color:#475569;line-height:1.6;">Hi <strong style="color:#1e293b;">${escapeHtml(profile.full_name)}</strong>, you have an appointment scheduled with <strong style="color:#1e293b;">${escapeHtml(appt.client_name)}</strong> on ${escapeHtml(formatDate(appt.appointment_date))} at ${formatTime(appt.start_time)}.</p>
            </td>
          </tr>

          <!-- Appointment Details Card -->
          <tr>
            <td style="padding:0 40px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-bottom:16px;">
                          <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Appointment Type</p>
                          <p style="margin:0;font-size:15px;color:#1e293b;font-weight:500;">${escapeHtml(appt.appointment_type)}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-bottom:16px;border-top:1px solid #e2e8f0;padding-top:16px;">
                          <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Date &amp; Time</p>
                          <p style="margin:0;font-size:15px;color:#1e293b;font-weight:500;">${escapeHtml(formatDate(appt.appointment_date))}</p>
                          <p style="margin:2px 0 0;font-size:14px;color:#64748b;">${formatTime(appt.start_time)} – ${formatTime(appt.end_time)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Client Information Section -->
          <tr>
            <td style="padding:0 40px 28px;">
              <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Client Information</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:10px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <p style="margin:0 0 6px;font-size:15px;color:#1e293b;font-weight:600;">${escapeHtml(appt.client_name)}</p>
                    <p style="margin:0 0 4px;font-size:13px;color:#78350f;line-height:1.5;"><strong>Phone:</strong> ${escapeHtml(appt.client_phone)}</p>
                    ${appt.client_email ? `<p style="margin:0;font-size:13px;color:#78350f;line-height:1.5;"><strong>Email:</strong> ${escapeHtml(appt.client_email)}</p>` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Office Location Section -->
          <tr>
            <td style="padding:0 40px 28px;">
              <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">Office Location</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <p style="margin:0 0 4px;font-size:15px;color:#1e293b;font-weight:600;">${escapeHtml(companyName)}</p>
                    ${addressLines.map(line => `<p style="margin:0 0 2px;font-size:13px;color:#0c4a6e;line-height:1.5;">${line}</p>`).join("")}
                    ${company?.phone ? `<p style="margin:6px 0 0;font-size:13px;color:#0c4a6e;"><strong>Phone:</strong> ${escapeHtml(company.phone)}</p>` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Action note -->
          <tr>
            <td style="padding:0 40px 32px;">
              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">Please sign in to the calendar to view or manage this appointment.</p>
            </td>
          </tr>`;

  const html = buildEmailShell(innerContent, logoUrl);
  return { subject, html, body: plainBody };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null);

    // Manual reminder: send immediately using appointment data provided by the caller
    if (body?.manual === true && body?.recipient_address) {
      const appt: AppointmentRow | null = body.appointment ?? null;
      const profile: ProfileRow | null = body.profile ?? null;

      if (!appt) {
        return new Response(
          JSON.stringify({ status: "failed", error: "Missing appointment data in request." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!profile) {
        return new Response(
          JSON.stringify({ status: "failed", error: "Missing coworker profile data in request." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const recipientType: "client" | "coworker" = body.recipient_type === "client" ? "client" : "coworker";

      // SMS channel via Bird API
      if (body.channel === "sms") {
        if (!birdApiKey) {
          return new Response(
            JSON.stringify({ status: "failed", channel: "sms", error: "BIRD_API_KEY is not configured in edge function secrets." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const smsMessage = buildClientSMS(appt, profile);
        const result = await sendBirdSMS(body.recipient_address, smsMessage, birdApiKey);

        if (result.success) {
          return new Response(
            JSON.stringify({ status: "sent", channel: "sms", recipient: body.recipient_address }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        } else {
          const error = result.error || "Unknown SMS error.";
          const softFail = isBillingOrRestrictionError(error);
          return new Response(
            JSON.stringify({
              status: softFail ? "skipped" : "failed",
              channel: "sms",
              error,
              softFail,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      // Default: email channel
      const { subject, html: emailHtml, body: emailBody } = recipientType === "client"
        ? buildClientEmail(appt, profile)
        : buildCoworkerEmail(appt, profile);

      const result = await sendEmail(body.recipient_address, subject, emailBody, emailHtml);

      if (result.success) {
        return new Response(
          JSON.stringify({ status: "sent", recipient: body.recipient_address }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } else {
        return new Response(
          JSON.stringify({ status: "failed", error: result.error || "Unknown email error." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Find pending reminders that are due
    const now = new Date().toISOString();
    const { data: reminders, error: fetchError } = await supabase
      .from("reminders")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_send_at", now)
      .order("scheduled_send_at", { ascending: true })
      .limit(50);

    if (fetchError) {
      return new Response(JSON.stringify({ status: "failed", error: fetchError.message }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { id: string; status: string; error?: string }[] = [];

    for (const reminder of (reminders || []) as ReminderRow[]) {
      // Skip if no recipient address
      if (!reminder.recipient_address) {
        await supabase
          .from("reminders")
          .update({ status: "skipped", error_details: "No recipient address", attempted_at: now })
          .eq("id", reminder.id);
        results.push({ id: reminder.id, status: "skipped" });
        continue;
      }

      // Fetch appointment details
      const { data: appt, error: apptError } = await supabase
        .from("appointments")
        .select("*")
        .eq("id", reminder.appointment_id)
        .maybeSingle<AppointmentRow>();

      if (apptError || !appt) {
        await supabase
          .from("reminders")
          .update({ status: "failed", error_details: "Appointment not found", attempted_at: now, retry_count: reminder.retry_count + 1 })
          .eq("id", reminder.id);
        results.push({ id: reminder.id, status: "failed", error: "Appointment not found" });
        continue;
      }

      // Fetch coworker profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", appt.assigned_to)
        .maybeSingle<ProfileRow>();

      if (!profile) {
        await supabase
          .from("reminders")
          .update({ status: "failed", error_details: "Coworker profile not found", attempted_at: now, retry_count: reminder.retry_count + 1 })
          .eq("id", reminder.id);
        results.push({ id: reminder.id, status: "failed", error: "Profile not found" });
        continue;
      }

      // Build email content
      const { subject, html, body } = reminder.recipient_type === "client"
        ? buildClientEmail(appt, profile)
        : buildCoworkerEmail(appt, profile);

      // Send email
      const result = await sendEmail(reminder.recipient_address, subject, body, html);

      if (result.success) {
        await supabase
          .from("reminders")
          .update({ status: "sent", attempted_at: now, error_details: "" })
          .eq("id", reminder.id);
        results.push({ id: reminder.id, status: "sent" });
      } else {
        // Retry logic: up to 3 retries
        const newRetryCount = reminder.retry_count + 1;
        if (newRetryCount >= 3) {
          await supabase
            .from("reminders")
            .update({ status: "failed", error_details: result.error || "Unknown error", attempted_at: now, retry_count: newRetryCount })
            .eq("id", reminder.id);
        } else {
          // Keep pending for retry, add backoff
          const backoffMinutes = Math.pow(2, newRetryCount) * 5;
          const nextAttempt = new Date(Date.now() + backoffMinutes * 60000).toISOString();
          await supabase
            .from("reminders")
            .update({ error_details: result.error || "Unknown error", attempted_at: now, retry_count: newRetryCount, scheduled_send_at: nextAttempt })
            .eq("id", reminder.id);
        }
        results.push({ id: reminder.id, status: "failed", error: result.error });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown runtime error in edge function.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
