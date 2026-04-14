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
    const { utms } = await req.json();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get IP and User-Agent
    const ip_address = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const user_agent = req.headers.get("user-agent") || "unknown";

    // 2. Extract UTMs
    const utm_source = utms?.utm_source || null;
    const utm_medium = utms?.utm_medium || null;
    const utm_campaign = utms?.utm_campaign || null;
    const utm_term = utms?.utm_term || null;
    const utm_content = utms?.utm_content || null;
    let email = utms?.email || null;
    
    // Some campaigns might pass the email parameter differently
    if (!email && utms?.e) email = utms.e;

    // 3. Create initial submission entry to get ID
    const { data: submission, error: submissionError } = await supabase
      .from("autodiagnostico_submissions")
      .insert({
        ip_address,
        user_agent,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        email,
      })
      .select("id")
      .single();

    if (submissionError) {
      throw submissionError;
    }

    return new Response(
      JSON.stringify({
        session_id: submission.id,
        email_captured: !!email
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
