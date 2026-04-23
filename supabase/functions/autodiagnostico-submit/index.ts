import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import nodemailer from "npm:nodemailer";
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
    const { session_id, answers, email, score_data, pdf_generated } = body;

    if (!session_id) {
      throw new Error("session_id is required");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get current record state
    const { data: currentRecord, error: fetchError } = await supabase
      .from("autodiagnostico_submissions")
      .select("email, email_sent, score_data")
      .eq("id", session_id)
      .single();

    if (fetchError) throw fetchError;

    // Build update object
    const updateData: any = {};
    if (answers) updateData.answers = answers;
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

    // Determine final email
    const finalEmail = email || currentRecord?.email;
    const isAlreadySent = currentRecord?.email_sent || false;

    let emailSentResult = false;
    let emailErrorDetail = null;

    // Send Email if we have an email and it hasn't been sent yet
    if (finalEmail && !isAlreadySent) {
      try {
        const transporter = nodemailer.createTransport({
          host: SMTP_HOSTNAME,
          port: SMTP_PORT,
          secure: SMTP_PORT === 465,
          auth: {
            user: SMTP_USERNAME,
            pass: SMTP_PASSWORD,
          },
        });

        // Use the NEW secure backend-orchestrated download link
        const downloadUrl = `https://xqjcexxltlixiddjbhfh.supabase.co/functions/v1/autodiagnostico-pdf-get?session_id=${session_id}`;
        
        const emailBody = autodiagnosticoTemplate
          .replace("{{pdf_download_link}}", downloadUrl)
          .replace("https://wa.me/573000000000", "https://wa.me/573186392462");


        await transporter.sendMail({
          from: SENDER_EMAIL,
          to: finalEmail,
          subject: "📋 Tu Autodiagnóstico de SoyProceso está listo",
          html: emailBody,
        });

        // Mark as sent in DB
        await supabase
          .from("autodiagnostico_submissions")
          .update({ email_sent: true })
          .eq("id", session_id);

        emailSentResult = true;
        console.log(`Email sent successfully to ${finalEmail}`);
      } catch (emailError) {
        console.error("Failed to send email:", emailError);
        emailErrorDetail = emailError.message;
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      email_sent: emailSentResult,
      already_sent: isAlreadySent,
      error_detail: emailErrorDetail 
    }), {
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
