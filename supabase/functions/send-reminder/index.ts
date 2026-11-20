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
  customer_id?: string | null;
  company_id?: string | null;
  status?: string | null;
  send_whatsapp: boolean | null;
  employee_20min_reminded_at?: string | null;
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
  phone: string | null;
  notify_day_of_whatsapp?: boolean | null;
  notify_20min_before?: boolean | null;
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

function formatDateMMDDYYYY(dateStr: string): string {
  const parts = (dateStr || "").split("-");
  if (parts.length === 3) {
    const [y, mo, d] = parts;
    return `${mo.padStart(2, "0")}/${d.padStart(2, "0")}/${y}`;
  }
  return dateStr;
}

function getZonedDateAndTime(date: Date, timeZone: string): { dateStr: string; timeStr: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    timeStr: `${hour}:${get("minute")}:${get("second")}`,
  };
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

function isDummyPhoneNumber(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return true;
  const last10 = digits.slice(-10);
  if (/^(\d)\1{9}$/.test(last10)) return true;
  if (last10 === "1234567890") return true;
  if (last10 === "0123456789") return true;
  if (/^55501\d{2}$/.test(last10)) return true;
  if (/^000\d{7}$/.test(last10)) return true;
  return false;
}

// Build the dynamic template variables for the client WhatsApp message
function buildClientSMS(appt: AppointmentRow, profile: ProfileRow) {
  const firstName = (appt.client_name || "Client").split(" ")[0];

  const company = appt.company_snapshot;
  const companyName = company?.name || "";

  const addressParts = [
    company?.address_line1,
    company?.address_line2,
    [company?.city, company?.state, company?.zip_code].filter(Boolean).join(" "),
  ].filter(Boolean);
  const companyAddress = addressParts.join(", ");

  const callbackNumber = profile.phone || "";

  return {
    firstName,
    companyName,
    companyAddress,
    callbackNumber,
    appointmentDate: formatDateShort(appt.appointment_date),
    appointmentTime: formatTime(appt.start_time),
  };
}

function buildScheduledWhatsappTemplate(
  appt: AppointmentRow,
  profile: ProfileRow,
  recipientFirstName?: string,
): ClientSmsTemplateData {
  const rawName = (recipientFirstName || appt.client_name || "Client").trim();
  const firstName = rawName.split(/\s+/)[0] || "Client";

  const company = appt.company_snapshot;
  const companyName = company?.name || "";

  const addressParts = [
    company?.address_line1,
    company?.address_line2,
    [company?.city, company?.state, company?.zip_code].filter(Boolean).join(" "),
  ].filter(Boolean);
  const companyAddress = addressParts.join(", ");

  const callbackNumber = profile.phone || company?.phone || "";

  return {
    firstName,
    companyName,
    companyAddress,
    callbackNumber,
    appointmentDate: formatDateMMDDYYYY(appt.appointment_date),
    appointmentTime: formatTime(appt.start_time),
  };
}

interface ClientSmsTemplateData {
  firstName: string;
  companyName: string;
  companyAddress: string;
  callbackNumber: string;
  appointmentDate: string;
  appointmentTime: string;
}

async function sendBirdSMS(toPhone: string, templateData: ClientSmsTemplateData, birdApiKey: string) {
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
          slug: "appointment_confirmation",
          language: "en",
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", name: "company_name", text: templateData.companyName },
                { type: "text", name: "first_name", text: templateData.firstName },
                { type: "text", name: "appointment_date", text: templateData.appointmentDate },
                { type: "text", name: "appointment_time", text: templateData.appointmentTime },
                { type: "text", name: "company_address", text: templateData.companyAddress },
                { type: "text", name: "callback_number", text: templateData.callbackNumber }
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
    // Bird returns 202 with a JSON body containing the message ID
    let birdMessageId: string | null = null;
    try {
      const resJson = await res.json();
      birdMessageId = resJson?.id || null;
    } catch {
      // Response was not JSON — proceed without message ID
    }
    return { success: true, birdMessageId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown Bird API error." };
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

function extractMissingCol(message: string): string | null {
  const m1 = message.match(/Could not find the '([^']+)' column/i);
  if (m1) return m1[1];
  const m2 = message.match(/column "([^"]+)"(?: of relation "[^"]+")? does not exist/i);
  if (m2) return m2[1];
  const m3 = message.match(/column [a-zA-Z0-9_]+\.([a-zA-Z0-9_]+) does not exist/i);
  if (m3) return m3[1];
  return null;
}

async function resolveCustomerId(appt: AppointmentRow): Promise<string | null> {
  if (appt.customer_id) return appt.customer_id;
  if (appt.id) {
    try {
      const { data } = await supabase
        .from("appointments")
        .select("customer_id")
        .eq("id", appt.id)
        .maybeSingle<{ customer_id: string | null }>();
      if (data?.customer_id) return data.customer_id;
    } catch {
      // Ignore lookup failures
    }
  }
  const email = (appt.client_email || "").trim().toLowerCase();
  if (email) {
    try {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .ilike("email", email)
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (data?.id) return data.id;
    } catch {
      // Ignore
    }
  }
  if (appt.client_phone && !isDummyPhoneNumber(appt.client_phone)) {
    try {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("phone", appt.client_phone)
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (data?.id) return data.id;
    } catch {
      // Ignore
    }
  }
  return null;
}

async function insertSentEmail(params: {
  customer_id?: string | null;
  appointment_id?: string | null;
  channel: "email" | "whatsapp";
  recipient_email?: string | null;
  recipient_phone?: string | null;
  recipient_name?: string | null;
  subject: string;
  body: string;
}): Promise<boolean> {
  const payload: Record<string, unknown> = {
    customer_id: params.customer_id || null,
    appointment_id: params.appointment_id || null,
    source_app: "calendar",
    channel: params.channel,
    recipient_email: (params.recipient_email || "").trim().toLowerCase(),
    recipient_phone: params.recipient_phone || null,
    recipient_name: params.recipient_name || null,
    subject: params.subject || "(No Subject)",
    body: params.body || "",
    status: "sent",
    sent_at: new Date().toISOString(),
  };

  for (let i = 0; i < 8; i++) {
    const { error } = await supabase.from("sent_emails").insert(payload);
    if (!error) return true;
    const missing = extractMissingCol(error.message || "");
    if (missing && missing in payload) {
      delete payload[missing];
      continue;
    }
    return false;
  }
  return false;
}

// Dynamic company logo map — keyed by company name from the appointment snapshot.
// Update or add entries here to customize each company's branded logo URL.
const COMPANY_LOGOS: Record<string, string> = {
  "STRESS FREE TAXES": `${yxjikabaxqzmutcxwqyy}/storage/v1/object/public/email-assets/stress-free-taxes-logo.png`,
  "MB Multiservice, LLC": `${yxjikabaxqzmutcxwqyy}/storage/v1/object/public/email-assets/mb-multiservice-logo.png`,
};

const DEFAULT_LOGO_URL = `${yxjikabaxqzmutcxwqyy}/storage/v1/object/public/email-assets/default-logo.png`;


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
        // Guard: skip if the customer has WhatsApp disabled or the recipient phone is a dummy/placeholder number.
        if (appt.send_whatsapp === false || isDummyPhoneNumber(body.recipient_address)) {
          return new Response(
            JSON.stringify({ status: "skipped", channel: "sms", softFail: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        if (!birdApiKey) {
          return new Response(
            JSON.stringify({ status: "failed", channel: "sms", error: "BIRD_API_KEY is not configured in edge function secrets." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const smsMessage = buildClientSMS(appt, profile);
        if (!smsMessage.callbackNumber) {
          return new Response(
            JSON.stringify({
              status: "failed",
              channel: "sms",
              error: "The coworker assigned to this appointment does not have a phone number on file. A callback number is required to send the WhatsApp confirmation.",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const result = await sendBirdSMS(body.recipient_address, smsMessage, birdApiKey);

        if (result.success) {
          // Create a reminder_attempts record to track Bird delivery status via webhook
          const originalMessage = `WhatsApp appointment confirmation to ${appt.client_name} for ${formatDate(appt.appointment_date)} at ${formatTime(appt.start_time)}`;
          const { data: attemptRec } = await supabase
            .from("reminder_attempts")
            .insert({
              appointment_id: appt.id,
              channel: "sms",
              recipient_address: body.recipient_address,
              bird_message_id: result.birdMessageId || null,
              delivery_status: "pending",
              template_slug: "appointment_confirmation",
              template_params: {
                company_name: smsMessage.companyName,
                first_name: smsMessage.firstName,
                appointment_date: smsMessage.appointmentDate,
                appointment_time: smsMessage.appointmentTime,
                company_address: smsMessage.companyAddress,
                callback_number: smsMessage.callbackNumber,
              },
              original_message: originalMessage,
              is_retry: !!body.parent_attempt_id,
              parent_attempt_id: body.parent_attempt_id || null,
            })
            .select("id")
            .maybeSingle();

          const customerId = await resolveCustomerId(appt);
          const logged = await insertSentEmail({
            customer_id: customerId,
            appointment_id: appt.id || null,
            channel: "whatsapp",
            recipient_email: appt.client_email || "",
            recipient_phone: body.recipient_address,
            recipient_name: appt.client_name,
            subject: `WhatsApp Appointment Confirmation – ${smsMessage.companyName || appt.client_name}`,
            body: originalMessage,
          });

          return new Response(
            JSON.stringify({
              status: "sent",
              channel: "sms",
              recipient: body.recipient_address,
              bird_message_id: result.birdMessageId || null,
              attempt_id: attemptRec?.id || null,
              sent_email_logged: logged,
            }),
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
        let logged = false;
        if (recipientType === "client") {
          const customerId = await resolveCustomerId(appt);
          logged = await insertSentEmail({
            customer_id: customerId,
            appointment_id: appt.id || null,
            channel: "email",
            recipient_email: body.recipient_address,
            recipient_phone: appt.client_phone || null,
            recipient_name: appt.client_name,
            subject,
            body: emailBody,
          });
        }
        return new Response(
          JSON.stringify({ status: "sent", recipient: body.recipient_address, sent_email_logged: logged }),
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
        .select("full_name, email, phone, notify_day_of_whatsapp, notify_20min_before")
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
        if (reminder.recipient_type === "client") {
          const customerId = await resolveCustomerId(appt);
          await insertSentEmail({
            customer_id: customerId,
            appointment_id: appt.id,
            channel: "email",
            recipient_email: reminder.recipient_address,
            recipient_phone: appt.client_phone || null,
            recipient_name: appt.client_name,
            subject,
            body,
          });

          // Customer Morning-Of WhatsApp (non-blocking; never fails email status)
          try {
            let customerPhone = appt.client_phone || "";
            let customerSendWhatsapp = appt.send_whatsapp !== false;

            if (customerId) {
              const { data: customerRec } = await supabase
                .from("customers")
                .select("phone, send_whatsapp")
                .eq("id", customerId)
                .maybeSingle<{ phone: string | null; send_whatsapp: boolean | null }>();
              if (customerRec) {
                if (customerRec.phone && !isDummyPhoneNumber(customerRec.phone)) {
                  customerPhone = customerRec.phone;
                }
                if (customerRec.send_whatsapp === false) {
                  customerSendWhatsapp = false;
                }
              }
            }

            if (customerSendWhatsapp && customerPhone && !isDummyPhoneNumber(customerPhone)) {
              if (!birdApiKey) {
                console.error(`Skipping morning-of customer WhatsApp for appointment ${appt.id}: BIRD_API_KEY is not configured.`);
              } else {
                const waData = buildScheduledWhatsappTemplate(appt, profile, appt.client_name);
                if (!waData.callbackNumber) {
                  console.error(`Skipping morning-of customer WhatsApp for appointment ${appt.id}: missing callback number.`);
                } else {
                  const waResult = await sendBirdSMS(customerPhone, waData, birdApiKey);
                  if (waResult.success) {
                    const originalMessage = `Morning-of WhatsApp reminder to ${appt.client_name} for ${waData.appointmentDate} at ${waData.appointmentTime}`;
                    await supabase.from("reminder_attempts").insert({
                      reminder_id: reminder.id,
                      appointment_id: appt.id,
                      channel: "sms",
                      recipient_address: customerPhone,
                      bird_message_id: waResult.birdMessageId || null,
                      delivery_status: "pending",
                      template_slug: "appointment_confirmation",
                      template_params: {
                        company_name: waData.companyName,
                        first_name: waData.firstName,
                        appointment_date: waData.appointmentDate,
                        appointment_time: waData.appointmentTime,
                        company_address: waData.companyAddress,
                        callback_number: waData.callbackNumber,
                      },
                      original_message: originalMessage,
                      is_retry: false,
                      parent_attempt_id: null,
                    });
                    await insertSentEmail({
                      customer_id: customerId,
                      appointment_id: appt.id,
                      channel: "whatsapp",
                      recipient_email: appt.client_email || "",
                      recipient_phone: customerPhone,
                      recipient_name: appt.client_name,
                      subject: `WhatsApp Appointment Reminder – ${waData.companyName || appt.client_name}`,
                      body: originalMessage,
                    });
                  } else {
                    console.error(`Morning-of customer WhatsApp failed for appointment ${appt.id}:`, waResult.error);
                  }
                }
              }
            }
          } catch (waErr) {
            console.error(`Morning-of customer WhatsApp exception for appointment ${appt.id}:`, waErr);
          }
        } else if (reminder.recipient_type === "coworker") {
          // Employee Morning-Of WhatsApp (non-blocking; never fails email status)
          try {
            if (profile.notify_day_of_whatsapp === true && profile.phone && !isDummyPhoneNumber(profile.phone)) {
              if (!birdApiKey) {
                console.error(`Skipping morning-of employee WhatsApp for appointment ${appt.id}: BIRD_API_KEY is not configured.`);
              } else {
                const empWaData = buildScheduledWhatsappTemplate(appt, profile, profile.full_name);
                const waResult = await sendBirdSMS(profile.phone, empWaData, birdApiKey);
                if (waResult.success) {
                  const originalMessage = `Morning-of employee WhatsApp reminder to ${profile.full_name} for ${appt.client_name} on ${empWaData.appointmentDate} at ${empWaData.appointmentTime}`;
                  await supabase.from("reminder_attempts").insert({
                    reminder_id: reminder.id,
                    appointment_id: appt.id,
                    channel: "sms",
                    recipient_address: profile.phone,
                    bird_message_id: waResult.birdMessageId || null,
                    delivery_status: "pending",
                    template_slug: "appointment_confirmation",
                    template_params: {
                      company_name: empWaData.companyName,
                      first_name: empWaData.firstName,
                      appointment_date: empWaData.appointmentDate,
                      appointment_time: empWaData.appointmentTime,
                      company_address: empWaData.companyAddress,
                      callback_number: empWaData.callbackNumber,
                    },
                    original_message: originalMessage,
                    is_retry: false,
                    parent_attempt_id: null,
                  });
                } else {
                  console.error(`Morning-of employee WhatsApp failed for appointment ${appt.id}:`, waResult.error);
                }
              }
            }
          } catch (empWaErr) {
            console.error(`Morning-of employee WhatsApp exception for appointment ${appt.id}:`, empWaErr);
          }
        }
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

    // 20-Minute Pre-Appointment Employee WhatsApp Alerts
    const preApptResults: { appointment_id: string; status: string; error?: string }[] = [];
    try {
      let businessTimezone = "America/New_York";
      const { data: settingsRow } = await supabase
        .from("app_settings")
        .select("business_timezone")
        .eq("id", 1)
        .maybeSingle<{ business_timezone: string | null }>();
      if (settingsRow?.business_timezone) {
        businessTimezone = settingsRow.business_timezone;
      }

      const nowDate = new Date();
      const windowEndDate = new Date(nowDate.getTime() + 22 * 60 * 1000);
      const nowLocal = getZonedDateAndTime(nowDate, businessTimezone);
      const endLocal = getZonedDateAndTime(windowEndDate, businessTimezone);
      const candidateDates = nowLocal.dateStr === endLocal.dateStr
        ? [nowLocal.dateStr]
        : [nowLocal.dateStr, endLocal.dateStr];
      const nowKey = `${nowLocal.dateStr}T${nowLocal.timeStr}`;
      const endKey = `${endLocal.dateStr}T${endLocal.timeStr}`;

      const { data: upcomingAppts, error: upcomingErr } = await supabase
        .from("appointments")
        .select("*")
        .is("employee_20min_reminded_at", null)
        .in("appointment_date", candidateDates);

      if (upcomingErr) {
        console.error("Failed to query upcoming appointments for 20-min alert:", upcomingErr.message);
      } else {
        for (const appt of (upcomingAppts || []) as AppointmentRow[]) {
          const normalizedStatus = (appt.status || "").trim().toLowerCase();
          if (
            normalizedStatus === "cancelled" ||
            normalizedStatus === "canceled" ||
            normalizedStatus === "completed" ||
            normalizedStatus === "no-show" ||
            normalizedStatus === "noshow" ||
            normalizedStatus === "no_show" ||
            normalizedStatus === "rescheduled"
          ) {
            continue;
          }

          const apptStartTime = appt.start_time.length === 5 ? `${appt.start_time}:00` : appt.start_time;
          const apptKey = `${appt.appointment_date}T${apptStartTime}`;
          if (apptKey < nowKey || apptKey > endKey) {
            continue;
          }

          const { data: empProfile } = await supabase
            .from("profiles")
            .select("full_name, email, phone, notify_day_of_whatsapp, notify_20min_before")
            .eq("id", appt.assigned_to)
            .maybeSingle<ProfileRow>();

          if (!empProfile || empProfile.notify_20min_before !== true) {
            continue;
          }
          if (!empProfile.phone || isDummyPhoneNumber(empProfile.phone)) {
            continue;
          }
          if (!birdApiKey) {
            console.error(`Skipping 20-min employee WhatsApp alert for appointment ${appt.id}: BIRD_API_KEY is not configured.`);
            continue;
          }

          // Atomically claim employee_20min_reminded_at so overlapping polls never double-send
          const remindedAt = new Date().toISOString();
          const { data: claimed, error: claimErr } = await supabase
            .from("appointments")
            .update({ employee_20min_reminded_at: remindedAt })
            .eq("id", appt.id)
            .is("employee_20min_reminded_at", null)
            .select("id")
            .maybeSingle();

          if (claimErr || !claimed) {
            if (claimErr) {
              console.error(`Failed to claim employee_20min_reminded_at for appointment ${appt.id}:`, claimErr.message);
            }
            continue;
          }

          const empWaData = buildScheduledWhatsappTemplate(appt, empProfile, empProfile.full_name);
          const waResult = await sendBirdSMS(empProfile.phone, empWaData, birdApiKey);

          if (waResult.success) {
            const originalMessage = `20-min pre-appointment WhatsApp alert to ${empProfile.full_name} for ${appt.client_name} on ${empWaData.appointmentDate} at ${empWaData.appointmentTime}`;
            await supabase.from("reminder_attempts").insert({
              appointment_id: appt.id,
              channel: "sms",
              recipient_address: empProfile.phone,
              bird_message_id: waResult.birdMessageId || null,
              delivery_status: "pending",
              template_slug: "appointment_confirmation",
              template_params: {
                company_name: empWaData.companyName,
                first_name: empWaData.firstName,
                appointment_date: empWaData.appointmentDate,
                appointment_time: empWaData.appointmentTime,
                company_address: empWaData.companyAddress,
                callback_number: empWaData.callbackNumber,
              },
              original_message: originalMessage,
              is_retry: false,
              parent_attempt_id: null,
            });
            preApptResults.push({ appointment_id: appt.id, status: "sent" });
          } else {
            console.error(`20-min employee WhatsApp alert failed for appointment ${appt.id}:`, waResult.error);
            preApptResults.push({ appointment_id: appt.id, status: "failed", error: waResult.error });
          }
        }
      }
    } catch (preApptErr) {
      console.error("20-min pre-appointment alert check failed:", preApptErr);
    }

    return new Response(
      JSON.stringify({ processed: results.length, results, pre_appointment_alerts: preApptResults }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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
