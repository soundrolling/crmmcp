import { NextRequest, NextResponse } from "next/server";
import { makeSupabase } from "@/lib/supabase";

/**
 * Optional: super-simple token guard using a query param (?token=...).
 * Use this only as a stopgap until you wire OAuth.
 */
function assertToken(req: NextRequest) {
  const required = process.env.MCP_TOKEN;
  if (!required) return; // no token configured
  
  const got = req.nextUrl.searchParams.get("token");
  if (got !== required) {
    throw new Response("Unauthorized", { status: 401 });
  }
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
      return NextResponse.json({
        jsonrpc: "2.0",
        id: mcpRequest.id,
        result: {
          tools: [
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
            { name: "crm_list_contact_deals", description: "List all deals for a specific contact" }
          ]
        }
      });
    }

    // For now, return a simple response for tool calls
    // In a full implementation, you would execute the actual tools here
    if (mcpRequest.method === "tools/call") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: mcpRequest.id,
        result: {
          content: [
            {
              type: "text",
              text: "Tool execution not yet implemented in HTTP mode. Use STDIO mode for full functionality."
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
  return NextResponse.json({
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
  });
}

export async function POST(req: NextRequest) {
  try { 
    assertToken(req); 
  } catch (resp: any) { 
    return resp; 
  }
  
  return handleMcpRequest(req);
}
