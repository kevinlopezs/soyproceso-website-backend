import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * AI POST GENERATOR (Dedicated Text & Research)
 * Focuses on topic research using Google Search and writing the blog post.
 */

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_CLOUD_PLATFORM_API_KEY");

Deno.serve(async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers });

  try {
    const { topic } = await req.json();

    if (!GOOGLE_API_KEY) throw new Error("Missing GOOGLE_CLOUD_PLATFORM_API_KEY");
    if (!topic) throw new Error("Missing topic parameter");

    console.log(`Generating text for topic: ${topic}`);

    const systemInstructions = `
        Eres un especialista en Psicología Organizacional y SST de Colombia.
        Escribe un artículo extenso sobre: "${topic}".
        Usa Google Search para informarte sobre normas y tendencias 2026 en Colombia.
        DEVUELVE ÚNICAMENTE UN OBJETO JSON con 'title' y 'content'. 
        No añadas explicaciones fuera del JSON.
    `;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_API_KEY}`;
    const response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: systemInstructions }] }],
            tools: [{ google_search: {} }]
        }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`Gemini Error: ${JSON.stringify(data.error)}`);

    const resultText = data.candidates[0].content.parts[0].text;
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No se pudo extraer JSON de la respuesta.");
    
    const result = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify({ success: true, data: result }), { headers });

  } catch (error: any) {
    console.error("Edge Function Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
});
