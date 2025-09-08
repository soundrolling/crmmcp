import { NextRequest, NextResponse } from "next/server";
import { makeSupabase } from "@/lib/supabase";

/**
 * Optional: super-simple token guard using a query param (?token=...).
 * Use this only as a stopgap until you wire OAuth.
 */
function getAuthTokenFromHeader(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function assertToken(req: NextRequest) {
  const required = process.env.MCP_TOKEN;
  if (!required) return; // no token configured
  
  const got = req.nextUrl.searchParams.get("token") || getAuthTokenFromHeader(req);
  if (got !== required) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

// Central list of tool descriptors (keep in sync with register-crm-tools.js)
const TOOL_DESCRIPTORS = [
  { name: "crm_create_contact", description: "Create a new contact record" },
  { name: "crm_upsert_company", description: "Create or update a company by name" },
  { name: "crm_update_deal", description: "Update a deal's stage and status" },
  { name: "crm_add_deal_note", description: "Add a note to a deal" },
  { name: "crm_add_lead_note", description: "Add a note to a lead" },
  { name: "crm_add_contact_note", description: "Add a note to a contact" },
  { name: "crm_add_company_note", description: "Add a note to a company" },
  { name: "crm_add_note", description: "Attach a note to contact/company/deal/lead" },
  { name: "crm_create_lead", description: "Create a new lead record" },
  { name: "crm_update_lead_status", description: "Update a lead's status" },
  { name: "crm_search_contacts", description: "Search for contacts by name or email" },
  { name: "crm_search_companies", description: "Search for companies by name" },
  { name: "crm_search_deals", description: "Search for deals by title, company, or contact person" },
  { name: "crm_search_leads", description: "Search for leads by name, email, or company" },
  { name: "crm_get_deals_by_contact", description: "Get all deals associated with a specific contact ID" },
  { name: "crm_get_contact_deal_associations", description: "Get detailed information about how a contact is associated with deals" },
  { name: "crm_cancel_deal", description: "Move a deal to cancelled/lost status" },
  { name: "crm_list_contact_deals", description: "List all deals for a specific contact" },
  // Generic updates
  { name: "crm_update_contact", description: "Update any allowed fields on a contact" },
  { name: "crm_update_company", description: "Update any allowed fields on a company" },
  { name: "crm_update_lead", description: "Update any allowed fields on a lead" },
  { name: "crm_update_deal_generic", description: "Update any allowed fields on a deal" },
  // Linking
  { name: "crm_link_contact_company", description: "Link a contact to a company" },
  { name: "crm_unlink_contact_company", description: "Unlink a contact from its company" },
  { name: "crm_link_contact_deal", description: "Link a contact to a deal" },
  { name: "crm_unlink_contact_deal", description: "Unlink a contact from a deal" },
  { name: "crm_link_company_deal", description: "Link a company to a deal" },
  { name: "crm_unlink_company_deal", description: "Unlink a company from a deal" }
];

function parseCsv(value: string | undefined | null): Set<string> | null {
  if (!value) return null;
  const set = new Set<string>();
  for (const part of value.split(",")) {
    const n = part.trim();
    if (n) set.add(n);
  }
  return set;
}

function filterToolsForEnv(tools: { name: string; description: string }[]) {
  const allow = parseCsv(process.env.MCP_ALLOW_TOOLS);
  const deny = parseCsv(process.env.MCP_DENY_TOOLS);
  let out = tools;
  if (allow && allow.size > 0) {
    out = out.filter(t => allow.has(t.name));
  }
  if (deny && deny.size > 0) {
    out = out.filter(t => !deny.has(t.name));
  }
  return out;
}

/**
 * Simple HTTP handler for MCP protocol
 * This provides basic MCP protocol support for tool listing
 */
async function handleMcpRequest(req: NextRequest) {
  try {
    // Get the request body
    const body = await req.text();
    
    // Parse the MCP request
    let mcpRequest;
    try {
      mcpRequest = JSON.parse(body);
    } catch (e) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    // Handle specific MCP methods
    if (mcpRequest.method === "initialize") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: mcpRequest.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "medicus-crm",
            version: "0.1.0"
          }
        }
      });
    }

    if (mcpRequest.method === "tools/list") {
      // Return list of available tools
      const tools = filterToolsForEnv(TOOL_DESCRIPTORS);
      return NextResponse.json({
        jsonrpc: "2.0",
        id: mcpRequest.id,
        result: {
          tools
        }
      });
    }

    // For now, return a simple response for tool calls
    // In a full implementation, you would execute the actual tools here
    if (mcpRequest.method === "tools/call") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: mcpRequest.id,
        error: {
          code: -32601,
          content: [
            {
              type: "text",
              text: "Tool execution over HTTP is not enabled. Use STDIO locally, or enable server execution."
            }
          ]
        }
      });
    }

    // Handle other MCP methods
    return NextResponse.json({
      jsonrpc: "2.0",
      id: mcpRequest.id,
      error: { code: -32601, message: `Method '${mcpRequest.method}' not found` }
    });

  } catch (error) {
    console.error("MCP request error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try { 
    assertToken(req); 
  } catch (resp: any) { 
    return resp; 
  }
  
  // For GET requests, return server info in MCP format
  return withCors(NextResponse.json({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "medicus-crm",
        version: "0.1.0"
      }
    }
  }));
}

export async function POST(req: NextRequest) {
  try { 
    assertToken(req); 
  } catch (resp: any) { 
    return resp; 
  }
  
  const res = await handleMcpRequest(req);
  return withCors(res);
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}
