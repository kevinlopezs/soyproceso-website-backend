import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const TIDYCAL_API_BASE = "https://tidycal.com/api";
const BOOKING_TYPE_ID = 1866756;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const token = Deno.env.get("TIDYCAL_PERSONAL_ACCESS_TOKEN");
    if (!token) {
      throw new Error("TIDYCAL_PERSONAL_ACCESS_TOKEN is not defined in edge function env");
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (req.method === 'GET' && action === 'timeslots') {
      const startsAt = url.searchParams.get("starts_at");
      const endsAt = url.searchParams.get("ends_at");

      if (!startsAt || !endsAt) {
         return new Response(JSON.stringify({ error: "Missing starts_at or ends_at parameters" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const tidycalRes = await fetch(`${TIDYCAL_API_BASE}/booking-types/${BOOKING_TYPE_ID}/timeslots?starts_at=${startsAt}&ends_at=${endsAt}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        }
      });

      const data = await tidycalRes.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: tidycalRes.status
      });
    } 
    
    if (req.method === 'POST' && action === 'bookings') {
      const reqBody = await req.json();
      
      const tidycalRes = await fetch(`${TIDYCAL_API_BASE}/booking-types/${BOOKING_TYPE_ID}/bookings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reqBody)
      });

      const data = await tidycalRes.json();
      return new Response(JSON.stringify(data), {
         headers: { ...corsHeaders, "Content-Type": "application/json" },
         status: tidycalRes.status
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action or method" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
