import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// This function handles webhook events for blog-related operations
// Currently handles: post published notifications, image processing events, etc.

interface WebhookEvent {
  type: string;
  data: any;
  timestamp: string;
}

interface WebhookResponse {
  success: boolean;
  message?: string;
  processed?: boolean;
  error?: string;
}

Deno.serve(async (req: Request) => {
  // CORS headers
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret",
  };

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // Verify webhook secret (if provided)
  const webhookSecret = req.headers.get("X-Webhook-Secret");
  const expectedSecret = Deno.env.get("WEBHOOK_SECRET");
  
  if (expectedSecret && webhookSecret !== expectedSecret) {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid webhook secret" }),
      { status: 401, headers }
    );
  }

  try {
    const event: WebhookEvent = await req.json();

    if (!event.type || !event.data) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid webhook event structure" }),
        { status: 400, headers }
      );
    }

    let response: WebhookResponse = { success: true, processed: false };

    // Process different event types
    switch (event.type) {
      case "post.published":
        // Handle new post published event
        console.log("Post published:", event.data);
        response = {
          success: true,
          processed: true,
          message: `Post "${event.data.title}" published successfully`
        };
        break;

      case "post.updated":
        console.log("Post updated:", event.data);
        response = {
          success: true,
          processed: true,
          message: `Post "${event.data.title}" updated successfully`
        };
        break;

      case "image.uploaded":
        console.log("Image uploaded:", event.data);
        response = {
          success: true,
          processed: true,
          message: `Image uploaded to ${event.data.url}`
        };
        break;

      case "test":
        response = {
          success: true,
          processed: true,
          message: "Webhook test successful"
        };
        break;

      default:
        response = {
          success: true,
          processed: false,
          message: `Event type "${event.type}" received but not processed`
        };
    }

    return new Response(JSON.stringify(response), { headers });

  } catch (error) {
    console.error("Error in blog-webhook function:", error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error occurred" 
      }),
      { status: 500, headers }
    );
  }
});