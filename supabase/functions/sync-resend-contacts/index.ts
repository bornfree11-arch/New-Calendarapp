import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY environment variable is not configured.");
    }

    const { audienceId, contacts, spanishSegmentId, englishSegmentId } = await req.json();
    if (!audienceId || !Array.isArray(contacts)) {
      throw new Error("Invalid request payload: audienceId and contacts array are required.");
    }

    const resSpanishId = spanishSegmentId || Deno.env.get("RESEND_SEGMENT_SPANISH_ID") || Deno.env.get("VITE_RESEND_SEGMENT_SPANISH_ID");
    const resEnglishId = englishSegmentId || Deno.env.get("RESEND_SEGMENT_ENGLISH_ID") || Deno.env.get("VITE_RESEND_SEGMENT_ENGLISH_ID");

    let synced = 0;
    let failed = 0;
    let spanishCount = 0;
    let englishCount = 0;
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!resSpanishId) {
      warnings.push("RESEND_SEGMENT_SPANISH_ID is not configured.");
    }
    if (!resEnglishId) {
      warnings.push("RESEND_SEGMENT_ENGLISH_ID is not configured.");
    }

    for (const contact of contacts) {
      try {
        const email = contact.email?.trim().toLowerCase();
        if (!email) {
          throw new Error("Contact missing valid email");
        }
        const lang = contact.preferred_language === 'en' ? 'en' : 'es';
        const firstName = contact.first_name || '';
        const lastName = contact.last_name || '';
        const unsubscribed = contact.unsubscribed ?? false;

        // 1. First attempt to create/upsert the contact in the General audience
        try {
          await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email,
              first_name: firstName,
              last_name: lastName,
              unsubscribed,
              properties: {
                language: lang,
              },
            }),
          });
        } catch {
          // Ignore create error if contact already exists in audience
        }

        // 2. Always follow up with PATCH /contacts/{email} to update existing contact details, unsubscription, and language property
        await fetch(`https://api.resend.com/contacts/${email}`, {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            unsubscribed,
            properties: {
              language: lang,
            },
            language: lang,
          }),
        }).catch(async () => {
          // Fallback patch to audience contacts if global contact patch fails
          await fetch(`https://api.resend.com/audiences/${audienceId}/contacts/${email}`, {
            method: "PATCH",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              first_name: firstName,
              last_name: lastName,
              unsubscribed,
              properties: {
                language: lang,
              },
            }),
          }).catch(() => {});
        });

        // 3. Force Segment Assignment & Cleanup (Spanish vs English)
        const targetSegmentId = lang === 'en' ? resEnglishId : resSpanishId;
        const oppositeSegmentId = lang === 'en' ? resSpanishId : resEnglishId;

        if (targetSegmentId) {
          const segRes = await fetch(`https://api.resend.com/contacts/${email}/segments/${targetSegmentId}`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
          }).catch(() => null);

          if (!segRes || !segRes.ok) {
            await fetch(`https://api.resend.com/audiences/${targetSegmentId}/contacts`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${resendApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ email }),
            }).catch(() => {});
          }

          if (lang === 'es') spanishCount++;
          if (lang === 'en') englishCount++;
        }

        if (oppositeSegmentId) {
          await fetch(`https://api.resend.com/contacts/${email}/segments/${oppositeSegmentId}`, {
            method: "DELETE",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
          }).catch(() => {});
        }

        synced++;

        // Rate-limit safety: brief delay (~200ms) between contacts
        await new Promise((r) => setTimeout(r, 200));

      } catch (err) {
        failed++;
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    return new Response(
      JSON.stringify({ synced, failed, spanishCount, englishCount, warnings, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal Server Error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
