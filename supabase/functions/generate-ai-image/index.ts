import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * AI IMAGE GENERATOR (Imagen 4.0 with Gemini Flash Image Fallback)
 */

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_CLOUD_PLATFORM_API_KEY");
const BUNNY_NET_USERNAME = Deno.env.get("BUNNY_NET_USERNAME") || "soyproceso";
const BUNNY_NET_ACCESS_KEY = Deno.env.get("BUNNY_NET_PASSWORD_API_ACCESS") || "";
const BUNNY_NET_HOSTNAME = Deno.env.get("BUNNY_NET_HOSTNAME") || "br.storage.bunnycdn.com";
let BUNNY_NET_CDN = Deno.env.get("BUNNY_NET_CDN") || "soyproceso.b-cdn.net";

// Clean CDN URL (remove protocol if present)
BUNNY_NET_CDN = BUNNY_NET_CDN.replace(/^https?:\/\//, "").replace(/\/$/, "");

Deno.serve(async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers });

  try {
    const { title, content, userId = "admin" } = await req.json();
    if (!GOOGLE_API_KEY) throw new Error("Missing GOOGLE_CLOUD_PLATFORM_API_KEY");

    console.log(`Generating image for: ${title}`);

    // STEP 1: PROMPT SYNTHESIS (Using Gemini 2.5 Flash)
    const synthUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`;
    const synthRes = await fetch(synthUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: `Based on: "${title}" - "${content.substring(0, 500)}", write a photography prompt for an AI image generator. No text, professional, realistic. JUST THE PROMPT.` }] }]
        }),
    });
    const synthData = await synthRes.json();
    const visualPrompt = synthData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || `Professional corporate photography for ${title}`;

    let base64Image = null;
    let chosenModel = "imagen-4.0";

    // STEP 2: TRY IMAGEN 4.0
    console.log("Attempting Imagen 4.0...");
    const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GOOGLE_API_KEY}`;
    const imagenRes = await fetch(imagenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            instances: [{ prompt: visualPrompt }],
            parameters: { sampleCount: 1, aspectRatio: "16:9" }
        }),
    });

    const imagenData = await imagenRes.json();
    if (imagenRes.ok && imagenData.predictions?.[0]) {
        base64Image = imagenData.predictions[0].bytesBase64Encoded || imagenData.predictions[0].image?.bytesBase64Encoded;
    } else {
        console.warn("Imagen 4 failed or restricted (Free Plan). Trying Fallback...");
        // STEP 3: FALLBACK TO GEMINI FLASH IMAGE
        chosenModel = "gemini-2.5-flash-image";
        const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GOOGLE_API_KEY}`;
        const fallbackRes = await fetch(fallbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Generate a professional 16:9 image based on this prompt: ${visualPrompt}` }] }]
            }),
        });
        const fallbackData = await fallbackRes.json();
        
        // Gemini Image models return actual image parts
        const imagePart = fallbackData?.candidates?.[0]?.content?.parts?.find((p: any) => p.inline_data?.mime_type?.startsWith("image/"));
        if (imagePart) {
            base64Image = imagePart.inline_data.data;
        } else {
            return new Response(JSON.stringify({ 
                success: false, 
                error: "All image generation methods failed for Free Tier.", 
                details: { imagenError: imagenData, fallbackError: fallbackData } 
            }), { headers });
        }
    }

    if (!base64Image) throw new Error("Could not extract image data from any model.");

    // STEP 4: UPLOAD TO BUNNY
    const binString = atob(base64Image);
    const buffer = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
        buffer[i] = binString.charCodeAt(i);
    }

    const timestamp = Date.now();
    const filename = `${timestamp}-ai-cover.png`;
    const bunnyPath = `blog-ai-covers/${userId}/${filename}`;
    const bunnyUploadUrl = `https://${BUNNY_NET_HOSTNAME}/${BUNNY_NET_USERNAME}/${bunnyPath}`;
    
    const bunnyRes = await fetch(bunnyUploadUrl, {
        method: "PUT",
        headers: { "AccessKey": BUNNY_NET_ACCESS_KEY, "Content-Type": "image/png" },
        body: buffer
    });

    if (!bunnyRes.ok) throw new Error(`Bunny.net Upload Error: ${await bunnyRes.text()}`);

    return new Response(JSON.stringify({ 
        success: true, 
        url: `https://${BUNNY_NET_CDN}/${bunnyPath}`,
        model: chosenModel,
        v: "4.0.2-FIXED"
    }), { headers });

  } catch (error: any) {
    console.error("Critical Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
});
