// Edge function "ses-events" (Supabase): recibe por SNS los eventos que publica
// Amazon SES (configuration set soyproceso-eventos) y guarda una fila por
// destinatario en public.ses_events.
//
// Seguridad: el endpoint exige ?token=SES_EVENTS_TOKEN y que el TopicArn sea
// SES_EVENTS_TOPIC_ARN. Ambos son secrets del proyecto.
import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("SES_EVENTS_TOKEN") ?? "";
const TOPIC_ARN = Deno.env.get("SES_EVENTS_TOPIC_ARN") ?? "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Row = Record<string, unknown>;

function cleanEmail(value: string): string {
  const m = value.match(/<([^>]+)>/);
  return (m ? m[1] : value).trim().toLowerCase();
}

function toRows(ev: any): Row[] {
  const type: string = ev.eventType ?? ev.notificationType ?? "Unknown";
  const mail = ev.mail ?? {};
  const base = {
    event_type: type,
    message_id: mail.messageId,
    source: mail.source ?? null,
    subject: mail.commonHeaders?.subject ?? null,
    configuration_set: mail.tags?.["ses:configuration-set"]?.[0] ?? null,
    sent_at: mail.timestamp ?? null,
  };
  const destination: string[] = mail.destination ?? [];

  let recipients: string[] = destination;
  let eventAt: string = mail.timestamp;
  let extra: Row = {};

  switch (type) {
    case "Delivery":
      recipients = ev.delivery?.recipients ?? destination;
      eventAt = ev.delivery?.timestamp ?? eventAt;
      extra = {
        detail: {
          smtpResponse: ev.delivery?.smtpResponse,
          processingTimeMillis: ev.delivery?.processingTimeMillis,
          reportingMTA: ev.delivery?.reportingMTA,
        },
      };
      break;
    case "Bounce":
      recipients = (ev.bounce?.bouncedRecipients ?? []).map((r: any) => r.emailAddress);
      eventAt = ev.bounce?.timestamp ?? eventAt;
      extra = {
        bounce_type: ev.bounce?.bounceType ?? null,
        bounce_subtype: ev.bounce?.bounceSubType ?? null,
        detail: { bouncedRecipients: ev.bounce?.bouncedRecipients },
      };
      break;
    case "Complaint":
      recipients = (ev.complaint?.complainedRecipients ?? []).map((r: any) => r.emailAddress);
      eventAt = ev.complaint?.timestamp ?? eventAt;
      extra = { detail: { complaintFeedbackType: ev.complaint?.complaintFeedbackType } };
      break;
    case "DeliveryDelay":
      recipients = (ev.deliveryDelay?.delayedRecipients ?? []).map((r: any) => r.emailAddress);
      eventAt = ev.deliveryDelay?.timestamp ?? eventAt;
      extra = { detail: { delayType: ev.deliveryDelay?.delayType } };
      break;
    case "Reject":
      extra = { detail: ev.reject ?? null };
      break;
    case "Rendering Failure":
      extra = { detail: ev.failure ?? null };
      break;
  }

  return recipients.filter(Boolean).map((r) => ({
    ...base,
    ...extra,
    recipient: cleanEmail(r),
    event_at: eventAt ?? new Date().toISOString(),
  }));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method !== "POST" || !TOKEN || url.searchParams.get("token") !== TOKEN) {
    return new Response("forbidden", { status: 403 });
  }

  let msg: any;
  try {
    msg = JSON.parse(await req.text());
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!TOPIC_ARN || msg.TopicArn !== TOPIC_ARN) {
    return new Response("forbidden", { status: 403 });
  }

  if (msg.Type === "SubscriptionConfirmation") {
    const sub = new URL(msg.SubscribeURL);
    if (sub.protocol !== "https:" || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(sub.hostname)) {
      return new Response("bad subscribe url", { status: 400 });
    }
    const r = await fetch(sub);
    return new Response(r.ok ? "confirmed" : "confirm failed", { status: r.ok ? 200 : 502 });
  }
  if (msg.Type !== "Notification") {
    return new Response("ignored");
  }

  const rows = toRows(JSON.parse(msg.Message));
  if (rows.length) {
    const { error } = await supabase
      .from("ses_events")
      .upsert(rows, { onConflict: "message_id,event_type,recipient", ignoreDuplicates: true });
    if (error) {
      console.error("insert ses_events", error);
      // 500 hace que SNS reintente según la delivery policy.
      return new Response("db error", { status: 500 });
    }
  }
  return new Response("ok");
});
