import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

interface WhatsAppPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          text?: { body: string };
          type: string;
          image?: { id: string; mime_type: string; sha256: string };
        }>;
      };
      field: string;
    }>;
  }>;
}

// Helper to handle Media (images, etc)
async function handleWhatsAppMedia(mediaId: string): Promise<string | null> {
  try {
    const version = Deno.env.get("META_VERSION") || "v22.0";
    const accessToken = Deno.env.get("META_USER_ACCESS_TOKEN");
    
    if (!accessToken) {
      console.error("Missing META_USER_ACCESS_TOKEN");
      return null;
    }

    // 1. Get Media URL
    console.log(`Getting URL for media ${mediaId}...`);
    const urlRes = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    
    if (!urlRes.ok) {
      const error = await urlRes.text();
      console.error("Error getting media URL from Meta:", error);
      return null;
    }

    const { url } = await urlRes.json();
    if (!url) return null;

    // 2. Download Media
    console.log(`Downloading media from Meta...`);
    const mediaRes = await fetch(url, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    
    if (!mediaRes.ok) {
      console.error("Error downloading media from Meta");
      return null;
    }

    const buffer = await mediaRes.arrayBuffer();
    const contentType = mediaRes.headers.get("Content-Type") || "image/jpeg";

    // 3. Upload to Bunny.net
    const storageZone = "soyproceso";
    const region = Deno.env.get("BUNNY_NET_HOSTNAME") || "br.storage.bunnycdn.com";
    const accessKey = Deno.env.get("BUNNY_NET_PASSWORD_API_ACCESS");
    const cdnUrl = Deno.env.get("BUNNY_NET_CDN") || "https://soyproceso.b-cdn.net";
    
    if (!accessKey) {
      console.error("Missing BUNNY_NET_PASSWORD_API_ACCESS");
      return null;
    }

    const timestamp = Date.now();
    const fileExt = contentType.split("/")[1] || "jpg";
    const path = `wa-media/${timestamp}-${mediaId}.${fileExt}`;
    const bunnyUrl = `https://${region}/${storageZone}/${path}`;

    console.log(`Uploading to Bunny.net: ${bunnyUrl}`);
    const uploadRes = await fetch(bunnyUrl, {
      method: "PUT",
      headers: {
        "AccessKey": accessKey,
        "Content-Type": contentType
      },
      body: buffer
    });

    if (!uploadRes.ok) {
      const error = await uploadRes.text();
      console.error("Error uploading to Bunny.net:", error);
      return null;
    }

    return `${cdnUrl}/${path}`;
  } catch (err) {
    console.error("Critical error in handleWhatsAppMedia:", err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey, X-Client-Info",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // 1. Handle Webhook Verification (GET)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const verifyToken = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");

    if (mode === "subscribe" && token === verifyToken) {
      console.log("WEBHOOK_VERIFIED");
      return new Response(challenge, { status: 200 });
    } else {
      console.error("WEBHOOK_VERIFICATION_FAILED", { mode, token, verifyToken });
      return new Response("Forbidden", { status: 403 });
    }
  }

  // 2. Handle Incoming Messages (POST)
  try {
    const payload: WhatsAppPayload = await req.json();
    console.log("Incoming WhatsApp Payload:", JSON.stringify(payload));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (value?.messages && value?.messages.length > 0) {
      const message = value.messages[0];
      const contact = value.contacts?.[0];
      const waId = message.from;
      const phoneNumber = contact?.wa_id || waId;
      const displayName = contact?.profile?.name || phoneNumber;
      
      let body = "";
      if (message.type === "text") {
        body = message.text?.body || "";
      } else if (message.type === "image") {
        // Handle Image
        const cdnUrl = await handleWhatsAppMedia(message.image.id);
        body = cdnUrl || "[Image fetch failed]";
      } else {
        body = `[${message.type} received]`;
      }

      // Upsert Chat
      const { data: chat, error: chatError } = await supabase
        .from("wa_chats")
        .upsert(
          { 
            whatsapp_id: waId, 
            phone_number: phoneNumber, 
            display_name: displayName,
            last_message: body,
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          { onConflict: "whatsapp_id" }
        )
        .select()
        .single();

      if (chatError) throw chatError;

      // Insert Message
      const { error: msgError } = await supabase.from("wa_messages").insert({
        chat_id: chat.id,
        whatsapp_message_id: message.id,
        type: message.type,
        body: body,
        from_me: false,
        metadata: message,
        created_at: new Date(parseInt(message.timestamp) * 1000).toISOString()
      });

      if (msgError) throw msgError;

      return new Response(JSON.stringify({ success: true }), { headers, status: 200 });
    }

    return new Response(JSON.stringify({ success: true, message: "No actionable data" }), { headers, status: 200 });

  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response(JSON.stringify({ error: error.message }), { headers, status: 500 });
  }
});
