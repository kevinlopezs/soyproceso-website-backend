import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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
    const { campaign_slug } = await req.json();

    if (!campaign_slug) {
      throw new Error("campaign_slug is required");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get IP and User-Agent
    const ip_address = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const user_agent = req.headers.get("user-agent") || "unknown";

    // 2. Fetch campaign details
    const { data: campaign, error: campaignError } = await supabase
      .from("experience_campaigns")
      .select("*")
      .eq("slug", campaign_slug)
      .eq("is_active", true)
      .single();

    if (campaignError || !campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found or inactive" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Create initial submission entry to get ID
    const { data: submission, error: submissionError } = await supabase
      .from("experience_submissions")
      .insert({
        campaign_slug,
        ip_address,
        user_agent
      })
      .select("id")
      .single();

    if (submissionError) {
      throw submissionError;
    }

    return new Response(
      JSON.stringify({
        submission_id: submission.id,
        campaign: {
          title: campaign.title,
          questions: campaign.questions,
          audio_url: campaign.audio_url,
          whatsapp_url: campaign.whatsapp_url,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
