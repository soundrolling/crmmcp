import { createClient } from "@supabase/supabase-js";

/**
 * Create a Supabase client instance for the Next.js app
 * This mirrors your existing env usage from the STDIO server
 */
export function makeSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  
  return createClient(url, key, { 
    auth: { persistSession: false } 
  });
}
