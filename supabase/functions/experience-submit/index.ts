import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Bunny.net configuration
const BUNNY_NET_USERNAME = Deno.env.get("BUNNY_NET_USERNAME") || ""; // Name of the storage zone
const BUNNY_NET_HOSTNAME = Deno.env.get("BUNNY_NET_HOSTNAME") || "br.storage.bunnycdn.com";
const BUNNY_NET_PASSWORD_API_ACCESS = Deno.env.get("BUNNY_NET_PASSWORD_API_ACCESS") || ""; // Pull zone key (often same as storage key)
const BUNNY_CDN_URL = Deno.env.get("BUNNY_NET_CDN") || "https://soyproceso.b-cdn.net";

Deno.serve(async (req: Request) => {
  // CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { 
        submission_id, 
        q1_answer, 
        q2_answer, 
        q3_answer, 
        photo_base64,
        campaign_slug = "experiencia-soyproceso-2026-1"
    } = await req.json();

    if (!submission_id) throw new Error("submission_id is required");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let photo_url = null;

    // 1. If photo is present, upload to Bunny.net
    if (photo_base64 && photo_base64.includes("base64,")) {
      const base64Data = photo_base64.split("base64,")[1];
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      const filename = `foto_${Date.now()}.jpg`;
      const path = `${campaign_slug}/${submission_id}/${filename}`;
      
      const uploadUrl = `https://${BUNNY_NET_HOSTNAME}/${BUNNY_NET_USERNAME}/${path}`;
      
      const bunnyResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/octet-stream",
          "AccessKey": BUNNY_NET_PASSWORD_API_ACCESS,
        },
        body: binaryData,
      });

      if (bunnyResponse.ok) {
        photo_url = `${BUNNY_CDN_URL}/${path}`;
      } else {
        const errorText = await bunnyResponse.text();
        console.error("Bunny.net error:", errorText);
      }
    }

    // 2. Update DB with answers and photo URL
    const { error: updateError } = await supabase
      .from("experience_submissions")
      .update({
        q1_answer,
        q2_answer,
        q3_answer,
        photo_url,
      })
      .eq("id", submission_id);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true, photo_url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
