import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUNNY_NET_PASSWORD_API_ACCESS = Deno.env.get("BUNNY_NET_PASSWORD_API_ACCESS") || "";
const BUNNY_NET_STORAGE_ZONE = "soyproceso";
const BUNNY_NET_REGION = Deno.env.get("BUNNY_NET_HOSTNAME") || "br.storage.bunnycdn.com";
const BUNNY_CDN_URL = Deno.env.get("BUNNY_NET_CDN") || "https://soyproceso.b-cdn.net";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-client-info",
};

// Custom lightweight CSV parser to avoid external dependencies and handle large files efficiently
function parseCSVRow(text: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function uploadToBunny(file: File, path: string): Promise<string> {
  const bunnyUrl = `https://${BUNNY_NET_REGION}/${BUNNY_NET_STORAGE_ZONE}/${path}`;
  const arrayBuffer = await file.arrayBuffer();
  
  const response = await fetch(bunnyUrl, {
    method: "PUT",
    headers: {
      "AccessKey": BUNNY_NET_PASSWORD_API_ACCESS,
      "Content-Type": file.type || "text/csv",
    },
    body: arrayBuffer,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bunny Upload Error ${response.status}: ${text}`);
  }
  return `${BUNNY_CDN_URL}/${path}`;
}

function safeParseInt(val: string): number {
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? 0 : parsed;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const token = authHeader.replace("Bearer ", "");
    let userId;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.sub;
    } catch (e) {
      throw new Error("Invalid JWT token");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase admin credentials");
    
    // We use the service role key to bypass RLS for massive bulk inserts securely from the Edge
    const supabase = createClient(supabaseUrl, supabaseKey);

    const formData = await req.formData();
    
    const campaignName = formData.get("campaignName") as string;
    const campaignDate = formData.get("campaignDate") as string;
    const sourceList = formData.get("sourceList") as string;
    
    if (!campaignName || !campaignDate) {
      throw new Error("campaignName and campaignDate are required");
    }

    const fileAll = formData.get("fileAll") as File;
    const fileUnopened = formData.get("fileUnopened") as File;
    const fileUnsubscribed = formData.get("fileUnsubscribed") as File;
    const fileClicked = formData.get("fileClicked") as File; // optional general clicked list

    const timestamp = Date.now();
    const campaignFolder = `email-campaigns/${userId}/${timestamp}`;

    let bunnyAllUrl = null;
    let bunnyUnopenedUrl = null;
    let bunnyUnsubscribedUrl = null;
    let bunnyClickedUrl = null;

    if (fileAll) bunnyAllUrl = await uploadToBunny(fileAll, `${campaignFolder}/all.csv`);
    if (fileUnopened) bunnyUnopenedUrl = await uploadToBunny(fileUnopened, `${campaignFolder}/unopened.csv`);
    if (fileUnsubscribed) bunnyUnsubscribedUrl = await uploadToBunny(fileUnsubscribed, `${campaignFolder}/unsubscribed.csv`);
    if (fileClicked) bunnyClickedUrl = await uploadToBunny(fileClicked, `${campaignFolder}/clicked.csv`);

    // 1. Create Campaign
    const { data: campaign, error: campaignError } = await supabase
      .from("email_campaigns")
      .insert({
        name: campaignName,
        campaign_date: campaignDate,
        source_list: sourceList,
        bunny_all_url: bunnyAllUrl,
        bunny_unopened_url: bunnyUnopenedUrl,
        bunny_unsubscribed_url: bunnyUnsubscribedUrl,
        bunny_clicked_url: bunnyClickedUrl,
        created_by: userId
      })
      .select()
      .single();

    if (campaignError) throw campaignError;
    const campaignId = campaign.id;

    // We'll collect all contacts to insert them in batches
    let contactsToInsert: any[] = [];
    let totalSent = 0;
    let totalUnopened = 0;
    let totalUnsubscribed = 0;
    let totalClicked = 0;

    // Helper to process a CSV file
    const processCSV = async (file: File | null, type: string) => {
      if (!file) return 0;
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length <= 1) return 0; // Empty or just headers
      
      const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase());
      const nameIdx = headers.indexOf("name");
      const emailIdx = headers.indexOf("email");
      const listIdx = headers.indexOf("list");
      const countryIdx = headers.indexOf("country");
      const lastActivityIdx = headers.indexOf("last activity");
      const clicksIdx = headers.indexOf("clicks");
      const statusIdx = headers.indexOf("status");

      if (emailIdx === -1) {
        console.warn(`[Warning] No email column found in ${type} CSV`);
        return 0;
      }

      let count = 0;
      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        if (row.length <= emailIdx || !row[emailIdx]) continue;
        
        let parsedDate = null;
        if (lastActivityIdx !== -1 && row[lastActivityIdx]) {
          const d = new Date(row[lastActivityIdx]);
          if (!isNaN(d.getTime())) {
            parsedDate = d.toISOString();
          }
        }

        contactsToInsert.push({
          campaign_id: campaignId,
          name: nameIdx !== -1 ? row[nameIdx] : null,
          email: row[emailIdx],
          type: type,
          clicks: clicksIdx !== -1 ? safeParseInt(row[clicksIdx]) : 0,
          list_name: listIdx !== -1 ? row[listIdx] : null,
          country: countryIdx !== -1 ? row[countryIdx] : null,
          last_activity: parsedDate,
          status: statusIdx !== -1 ? row[statusIdx] : null
        });
        count++;
      }
      return count;
    };

    totalSent = await processCSV(fileAll, "all");
    totalUnopened = await processCSV(fileUnopened, "unopened");
    totalUnsubscribed = await processCSV(fileUnsubscribed, "unsubscribed");
    totalClicked = await processCSV(fileClicked, "clicked");

    // Process dynamic attribution files
    const attributionData: any[] = [];
    let index = 0;
    while (formData.has(`fileAttribution_${index}`) && formData.has(`labelAttribution_${index}`)) {
      const fileAttr = formData.get(`fileAttribution_${index}`) as File;
      const labelAttr = formData.get(`labelAttribution_${index}`) as string;
      
      if (fileAttr && labelAttr) {
        const attrUrl = await uploadToBunny(fileAttr, `${campaignFolder}/attribution-${index}.csv`);
        const typeLabel = `attribution:${labelAttr}`;
        const count = await processCSV(fileAttr, typeLabel);
        
        attributionData.push({
          campaign_id: campaignId,
          url_label: labelAttr,
          bunny_url: attrUrl,
          total_clickers: count
        });
      }
      index++;
    }

    // Insert Attribution Links Metadata
    if (attributionData.length > 0) {
      const { error: attrError } = await supabase
        .from("email_campaign_link_uploads")
        .insert(attributionData);
      if (attrError) throw attrError;
    }

    // Insert Contacts in Batches of 1,000 to avoid request limits for huge files (up to 50k+)
    const BATCH_SIZE = 1000;
    for (let i = 0; i < contactsToInsert.length; i += BATCH_SIZE) {
      const batch = contactsToInsert.slice(i, i + BATCH_SIZE);
      const { error: batchError } = await supabase
        .from("email_campaign_contacts")
        .insert(batch);
      
      if (batchError) {
        console.error(`Error inserting batch ${i}:`, batchError);
        // Continue with other batches, don't fail entire request
      }
    }

    // Update Campaign Stats
    await supabase
      .from("email_campaigns")
      .update({
        total_sent: totalSent,
        total_unopened: totalUnopened,
        total_unsubscribed: totalUnsubscribed,
        total_clicked: totalClicked
      })
      .eq("id", campaignId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        campaignId,
        stats: {
          totalSent, totalUnopened, totalUnsubscribed, totalClicked, totalAttributions: attributionData.length
        }
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Campaign Upload Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
