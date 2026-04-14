import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

Deno.serve(async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey, X-Client-Info",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    const { chatId, message, type = 'text', mediaUrl } = await req.json();

    if (!chatId || (type === 'text' && !message) || (type === 'image' && !mediaUrl)) {
      return new Response(JSON.stringify({ error: "Missing required fields (chatId, message/mediaUrl)" }), { status: 400, headers });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Get Chat details
    const { data: chat, error: chatError } = await supabase
      .from("wa_chats")
      .select("*")
      .eq("id", chatId)
      .single();

    if (chatError || !chat) throw new Error("Chat not found");

    const phoneNumberId = Deno.env.get("META_PHONE_NUMBER_ID");
    const accessToken = Deno.env.get("META_USER_ACCESS_TOKEN");
    const version = Deno.env.get("META_VERSION") || "v22.0";

    // 2. Build WhatsApp API Payload
    const waPayload: any = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: chat.whatsapp_id,
      type: type,
    };

    if (type === "text") {
      waPayload.text = { body: message };
    } else if (type === "image") {
      waPayload.image = { link: mediaUrl };
      if (message) waPayload.image.caption = message;
    }

    // 2. Call WhatsApp API
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(waPayload),
    });

    const result = await response.json();
    console.log("WhatsApp Send Response:", result);

    if (!response.ok) {
      throw new Error(result.error?.message || "Failed to send message via WhatsApp");
    }

    // 3. Save message to database
    const { error: msgError } = await supabase.from("wa_messages").insert({
      chat_id: chatId,
      whatsapp_message_id: result.messages?.[0]?.id,
      type: type,
      body: type === 'image' ? mediaUrl : message,
      from_me: true,
      metadata: { ...result, sent_payload: waPayload },
      status: "sent"
    });

    if (msgError) throw msgError;

    // 4. Update last message in chat
    await supabase.from("wa_chats").update({
      last_message: type === 'image' ? "📷 Foto" : message,
      last_message_at: new Date().toISOString()
    }).eq("id", chatId);

    return new Response(JSON.stringify({ success: true, result }), { headers, status: 200 });

  } catch (error) {
    console.error("Error in whatsapp-send:", error);
    return new Response(JSON.stringify({ error: error.message }), { headers, status: 500 });
  }
});
