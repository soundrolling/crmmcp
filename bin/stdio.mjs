#!/usr/bin/env node

import 'dotenv/config';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { registerCrmTools } from "../lib/register-crm-tools.js";

// --- Supabase client (exactly as you already do)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { 
  auth: { persistSession: false } 
});

// --- MCP server
const server = new McpServer({ 
  name: "medicus-crm", 
  version: "0.1.0" 
});

// Register all CRM tools
registerCrmTools(server, supabase);

// Connect via STDIO transport
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("Medicus CRM MCP Server started via STDIO");
