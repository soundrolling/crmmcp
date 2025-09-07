import { NextRequest, NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { makeSupabase } from "@/lib/supabase";
import { registerCrmTools } from "@/lib/register-crm-tools";

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
 * This creates a fresh MCP server per request and handles the protocol
 */
async function handleMcpRequest(req: NextRequest) {
  try {
    // Create a new MCP server instance
    const server = new McpServer({ 
      name: "medicus-crm", 
      version: "0.1.0" 
    });

    // Create Supabase client and register tools
    const supabase = makeSupabase();
    registerCrmTools(server, supabase);

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

    // Handle the MCP request
    const response = await server.handleRequest(mcpRequest);
    
    return NextResponse.json(response);
  } catch (error) {
    console.error("MCP request error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
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
  
  // For GET requests, return server info
  return NextResponse.json({
    name: "medicus-crm",
    version: "0.1.0",
    protocol: "mcp",
    capabilities: {
      tools: true
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
