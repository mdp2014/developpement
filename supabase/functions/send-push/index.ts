import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { recipientId, title, body, tag, requireInteraction, data } = await req.json();
    if (!recipientId) {
      return new Response(JSON.stringify({ error: "recipientId required" }), { status: 400 });
    }

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(JSON.stringify({ skipped: true, reason: "VAPID not configured" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("subscription")
      .eq("user_id", recipientId);

    if (error || !subs?.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({
      title: title || "Messagerie",
      body: body || "",
      tag: tag || "msg",
      requireInteraction: !!requireInteraction,
      data: data || {},
    });

    let sent = 0;
    for (const row of subs) {
      try {
        const ok = await sendWebPush(row.subscription, payload);
        if (ok) sent++;
      } catch (e) {
        console.error("push fail:", e);
      }
    }

    return new Response(JSON.stringify({ sent }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});

async function sendWebPush(subscription: Record<string, unknown>, payload: string): Promise<boolean> {
  const webpush = await import("https://esm.sh/web-push@3.6.7");
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  await webpush.sendNotification(subscription as webpush.PushSubscription, payload);
  return true;
}
