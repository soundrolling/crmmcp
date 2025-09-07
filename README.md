# Medicus CRM MCP Server

A Model Context Protocol (MCP) server for the Medicus CRM system, supporting both local STDIO and remote HTTP access.

## Features

- 18 CRM tools for managing companies, contacts, and related data
- Supabase integration for data persistence
- Local STDIO transport for development
- Remote HTTP transport for production deployment
- Token-based authentication for security

## Local Development

### Prerequisites

- Node.js 18+
- Supabase project with service role key

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create environment file:
   ```bash
   cp env.example .env.local
   ```

3. Configure your environment variables in `.env.local`:
   ```
   SUPABASE_URL=your_supabase_url_here
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
   MCP_TOKEN=your_long_random_token_here
   ```

### Running Locally

#### STDIO Mode (for local MCP clients)
```bash
npm run mcp:stdio
```

#### HTTP Mode (for testing remote access)
```bash
npm run dev
```

Then test with MCP Inspector:
```bash
npx @modelcontextprotocol/inspector http://localhost:3000/api/mcp?token=your_token
```

## Deployment to Vercel

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Deploy:
   ```bash
   vercel
   ```

3. Set environment variables in Vercel dashboard:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `MCP_TOKEN` (optional)

4. Your MCP server will be available at:
   ```
   https://your-app.vercel.app/api/mcp?token=your_token
   ```

## Adding to Claude

In Claude Desktop or Web:
1. Go to Settings → Connectors
2. Add custom connector
3. Enter your Vercel URL: `https://your-app.vercel.app/api/mcp?token=your_token`

## Tool Registration

The main tool registration logic is in `lib/register-crm-tools.js`. This file contains:

- Helper functions for error handling and data manipulation
- All 18 CRM tool registrations
- Supabase integration logic

To add new tools or modify existing ones, edit this file. The changes will be available in both STDIO and HTTP modes.

## Security

- The server uses Supabase service role key for database access
- Optional token-based authentication prevents unauthorized access
- For production, consider implementing OAuth instead of simple tokens

## Architecture

```
├── lib/
│   ├── register-crm-tools.js    # Shared tool registration logic
│   └── supabase.js              # Supabase client factory
├── bin/
│   └── stdio.mjs                # Local STDIO server
├── app/
│   └── api/
│       └── mcp/
│           └── route.ts         # HTTP MCP endpoint
└── package.json                 # Dependencies and scripts
```
