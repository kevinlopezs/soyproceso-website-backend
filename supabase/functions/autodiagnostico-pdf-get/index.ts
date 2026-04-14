import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Bunny.net configuration from Supabase secrets
const BUNNY_STORAGE_PASSWORD = Deno.env.get("BUNNY_NET_PASSWORD_API_ACCESS") ?? "";
const BUNNY_STORAGE_ZONE = "soyproceso";
const BUNNY_STORAGE_HOSTNAME = Deno.env.get("BUNNY_NET_HOSTNAME") ?? "br.storage.bunnycdn.com";
const BUNNY_CDN_URL = Deno.env.get("BUNNY_NET_CDN") ?? "https://soyproceso.b-cdn.net";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "session_id is required" }), { status: 400 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch record
    const { data: record, error: fetchError } = await supabase
      .from("autodiagnostico_submissions")
      .select("score_data, pdf_url")
      .eq("id", sessionId)
      .single();

    if (fetchError || !record) {
      return new Response(JSON.stringify({ error: "Session not found" }), { status: 404 });
    }

    // 2. If already exists in Bunny, redirect
    if (record.pdf_url) {
      console.log(`Redirecting to existing PDF: ${record.pdf_url}`);
      return Response.redirect(record.pdf_url, 307);
    }

    // 3. If missing, generate via Next.js Renderer
    console.log(`Generating PDF for session ${sessionId}...`);
    const rendererUrl = "https://soyproceso.com/api/pdf-diagnostico";
    const renderResponse = await fetch(rendererUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scoreResult: record.score_data, sessionId }),
    });

    if (!renderResponse.ok) {
      const errText = await renderResponse.text();
      console.error("Renderer error:", errText);
      throw new Error("Failed to render PDF via Next.js");
    }

    const pdfBlob = await renderResponse.blob();
    const pdfArrayBuffer = await pdfBlob.arrayBuffer();

    // 4. Upload to Bunny.net
    const folder = "pdf-reports";
    const filename = `autodiagnostico-${sessionId}.pdf`;
    const bunnyPath = `${folder}/${filename}`;
    const bunnyUploadUrl = `https://${BUNNY_STORAGE_HOSTNAME}/${BUNNY_STORAGE_ZONE}/${bunnyPath}`;

    console.log(`Uploading to Bunny.net: ${bunnyUploadUrl}`);
    const bunnyResponse = await fetch(bunnyUploadUrl, {
      method: "PUT",
      headers: {
        "AccessKey": BUNNY_STORAGE_PASSWORD,
        "Content-Type": "application/pdf",
      },
      body: pdfArrayBuffer,
    });

    if (!bunnyResponse.ok) {
      console.error("Bunny.net upload failed:", await bunnyResponse.text());
    } else {
      // 5. Update DB with new URL
      const cdnUrl = `${BUNNY_CDN_URL.replace(/\/$/, "")}/${bunnyPath}`;
      await supabase
        .from("autodiagnostico_submissions")
        .update({ pdf_url: cdnUrl, pdf_generated: true })
        .eq("id", sessionId);
      
      console.log(`PDF stored and DB updated: ${cdnUrl}`);
    }

    // Return the PDF buffer directly for this first time
    return new Response(pdfArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Autodiagnostico-SoyProceso-${sessionId}.pdf"`,
      },
    });

  } catch (error) {
    console.error("Error in get-pdf function:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
