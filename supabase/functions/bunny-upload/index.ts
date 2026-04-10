import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Bunny.net configuration - should be set as environment variables
const BUNNY_NET_USERNAME = Deno.env.get("BUNNY_NET_USERNAME") || "";
const BUNNY_NET_PASSWORD_API_ACCESS = Deno.env.get("BUNNY_NET_PASSWORD_API_ACCESS") || "";
const BUNNY_NET_STORAGE_ZONE = "soyproceso"; // Storage zone name
const BUNNY_NET_REGION = Deno.env.get("BUNNY_NET_HOSTNAME") || "br.storage.bunnycdn.com";
const BUNNY_CDN_URL = Deno.env.get("BUNNY_NET_CDN") || "https://soyproceso.b-cdn.net";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max file size

// Allowed MIME types for images
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml"
];

interface UploadRequest {
  filename: string;
  contentType: string;
  folder?: string;
}

interface UploadResponse {
  success: boolean;
  uploadUrl?: string;
  cdnUrl?: string;
  path?: string;
  error?: string;
}

interface BunnyUploadResponse {
  success: boolean;
  message?: string;
  statusCode?: number;
}

Deno.serve(async (req: Request) => {
  console.log(`[Edge Function] Request received: ${req.method}`);

  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info",
  };

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    // 1. Verify Authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.error("[Edge Function] Forbidden: Missing Authorization header");
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid authorization header" }),
        { status: 401, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // 2. Extract user ID
    let userId;
    try {
      const token = authHeader.replace("Bearer ", "");
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.sub;
    } catch (e) {
      console.error("[Edge Function] Error parsing JWT:", e);
      throw new Error("Invalid JWT token");
    }

    if (!userId) {
      throw new Error("Unable to extract user ID from token");
    }
    console.log(`[Edge Function] Authenticated user: ${userId}`);

    // 3. Parse Body
    console.log("[Edge Function] Parsing form data...");
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const customFolder = formData.get("folder") as string || "blog-images";

    if (!file) {
      console.error("[Edge Function] No file provided");
      throw new Error("No file provided in the request");
    }
    console.log(`[Edge Function] File received: ${file.name} (${file.size} bytes, ${file.type})`);

    // 4. Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
      console.error(`[Edge Function] Invalid type: ${file.type}`);
      throw new Error(`File type ${file.type} not allowed.`);
    }

    // 5. Generate path
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 10);
    const fileName = file.name;
    const fileExt = fileName.includes('.') ? fileName.split('.').pop() : 'jpg';
    const nameWithoutExt = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
    const cleanFilename = nameWithoutExt.toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/-+/g, "-");
    const path = `${customFolder}/${userId}/${timestamp}-${randomString}-${cleanFilename}.${fileExt}`;

    // 6. Config & URL
    const storageZone = BUNNY_NET_STORAGE_ZONE;
    const region = BUNNY_NET_REGION;
    const bunnyUrl = `https://${region}/${storageZone}/${path}`;
    
    console.log(`[Edge Function] Starting upload to Bunny.net: ${bunnyUrl}`);

    // 7. Upload to Bunny.net
    const arrayBuffer = await file.arrayBuffer();
    console.log(`[Edge Function] ArrayBuffer ready, size: ${arrayBuffer.byteLength}`);

    const bunnyResponse = await fetch(bunnyUrl, {
      method: "PUT",
      headers: {
        "AccessKey": BUNNY_NET_PASSWORD_API_ACCESS,
        "Content-Type": file.type,
      },
      body: arrayBuffer,
    });

    if (!bunnyResponse.ok) {
      const errorText = await bunnyResponse.text();
      console.error(`[Edge Function] Bunny.net error: ${bunnyResponse.status}`, errorText);
      throw new Error(`Bunny.net Upload Failed: ${bunnyResponse.status} - ${errorText}`);
    }

    console.log("[Edge Function] Upload successful!");

    // 8. Success response
    return new Response(
      JSON.stringify({
        success: true,
        url: `${BUNNY_CDN_URL}/${path}`,
        path: path,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[Edge Function] Error:", error.message);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error occurred" 
      }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
});