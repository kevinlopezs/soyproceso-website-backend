import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { SmtpClient } from "https://deno.land/x/smtp@v0.7.0/mod.ts";
import { autodiagnosticoTemplate } from "../_shared/templates/autodiagnostico-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// SMTP Config from Env
const SMTP_HOSTNAME = Deno.env.get("AWS_SES_SMTP_ENDPOINT") ?? "";
const SMTP_PORT = parseInt(Deno.env.get("AWS_SES_SMTP_PORT") ?? "587");
const SMTP_USERNAME = Deno.env.get("AWS_SMTP_USER_NAME") ?? "";
const SMTP_PASSWORD = Deno.env.get("AWS_SMTP_PASSWORD") ?? "";
const SENDER_EMAIL = Deno.env.get("AWS_SES_SENDER_EMAIL") ?? "contactanos@soyproceso.com";

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
    const body = await req.json();
    const { session_id, answers, email, score_data, pdf_generated, pdf_url } = body;

    if (!session_id) {
      throw new Error("session_id is required");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Build update object
    const updateData: any = {};
    
    if (answers) {
      const { data: existingData } = await supabase
        .from("autodiagnostico_submissions")
        .select("answers")
        .eq("id", session_id)
        .single();
      
      updateData.answers = { ...(existingData?.answers || {}), ...answers };
    }
    
    if (email) updateData.email = email;
    if (score_data) updateData.score_data = score_data;
    if (pdf_generated !== undefined) updateData.pdf_generated = pdf_generated;

    // Update submission
    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from("autodiagnostico_submissions")
        .update(updateData)
        .eq("id", session_id);

      if (updateError) throw updateError;
    }

    // Send Email if email is provided and pdf is generated or url is provided
    if (email && (pdf_url || pdf_generated)) {
      try {
        const client = new SmtpClient();
        await client.connectTLS({
          hostname: SMTP_HOSTNAME,
          port: SMTP_PORT,
          username: SMTP_USERNAME,
          password: SMTP_PASSWORD,
        });

        const finalUrl = pdf_url || `https://soyproceso.com/api/pdf-diagnostico?session_id=${session_id}`;
        const emailBody = autodiagnosticoTemplate
          .replace("{{pdf_download_link}}", finalUrl)
          .replace("https://wa.me/573000000000", "https://wa.me/573123456789"); // Actual WhatsApp number if known

        await client.send({
          from: SENDER_EMAIL,
          to: email,
          subject: "Tu Autodiagnóstico de SoyProceso está listo",
          content: emailBody,
          html: emailBody,
        });

        await client.close();
        console.log(`Email sent successfully to ${email}`);
      } catch (emailError) {
        console.error("Failed to send email:", emailError);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
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
