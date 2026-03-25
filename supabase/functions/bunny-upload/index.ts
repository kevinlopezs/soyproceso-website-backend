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
  // CORS headers
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // Verify JWT (Supabase will automatically verify if verify_jwt is enabled)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing or invalid authorization header" }),
      { status: 401, headers }
    );
  }

  try {
    const { filename, contentType, folder = "blog-images" }: UploadRequest = await req.json();

    // Validate request
    if (!filename || !contentType) {
      return new Response(
        JSON.stringify({ success: false, error: "Filename and content type are required" }),
        { status: 400, headers }
      );
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(contentType.toLowerCase())) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `File type not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}` 
        }),
        { status: 400, headers }
      );
    }

    // Extract user ID from JWT
    const token = authHeader.replace("Bearer ", "");
    const payload = JSON.parse(atob(token.split(".")[1]));
    const userId = payload.sub;

    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, error: "Unable to extract user ID from token" }),
        { status: 400, headers }
      );
    }

    // Generate unique path for the file
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 10);
    
    // Clean filename
    const cleanFilename = filename
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "-")
      .replace(/-+/g, "-");
    
    const fileExtension = filename.includes(".") 
      ? filename.substring(filename.lastIndexOf("."))
      : contentType.includes("image/")
        ? "." + contentType.split("/")[1]
        : ".bin";

    const path = `${folder}/${userId}/${timestamp}-${randomString}${fileExtension}`;

    // Construct Bunny.net upload URL
    const uploadUrl = `https://${BUNNY_NET_REGION}/${BUNNY_NET_STORAGE_ZONE}/${path}`;
    const cdnUrl = `${BUNNY_CDN_URL}/${path}`;

    // Create response
    const response: UploadResponse = {
      success: true,
      uploadUrl,
      cdnUrl,
      path,
    };

    return new Response(JSON.stringify(response), { headers });

  } catch (error) {
    console.error("Error in bunny-upload function:", error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error occurred" 
      }),
      { status: 500, headers }
    );
  }
});