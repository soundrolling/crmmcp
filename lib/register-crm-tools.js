import { z } from "zod";

/**
 * Register *all* your CRM tools on the given MCP server instance.
 * 
 * This module contains all the tool registration logic that can be shared
 * between the local STDIO server and the remote HTTP server.
 */

// Helper to stringify results (matches your existing implementation)
const ok = (msg, json) => ({
  content: [
    { type: "text", text: msg },
    { type: "text", text: json ? `\n\nResult:\n${JSON.stringify(json, null, 2)}` : "" }
  ]
});

// ---- small utils (matches your existing implementation)
const omit = (obj, ...keys) => {
  const c = { ...obj };
  for (const k of keys) delete c[k];
  return c;
};

function friendlySupabaseError(table, error) {
  const msg = error?.message || String(error || "Unknown error");
  if (/row-level security/i.test(msg)) {
    throw new Error(`Write blocked by Row Level Security on "${table}". Use a service-role key locally or adjust RLS.`);
  }
  if (/violates foreign key constraint/i.test(msg)) {
    throw new Error(`Foreign key error writing to "${table}": ${msg}`);
  }
  throw new Error(msg);
}

// Sanitize arbitrary update payloads against a whitelist and blocked keys
function sanitizeUpdates(rawUpdates, allowedKeys, blockedKeys = ["id", "created_at"]) {
  const updates = {};
  for (const key of Object.keys(rawUpdates || {})) {
    if (blockedKeys.includes(key)) continue;
    if (allowedKeys.includes(key)) updates[key] = rawUpdates[key];
  }
  return updates;
}

/**
 * Insert a note with smart fallbacks for common schema diffs:
 * - company_id may be required or may not exist
 * - author vs created_by
 * - activity_date vs created_at (or absent)
 * - body vs content
 * - type might not exist
 */
async function smartInsertNote(supabase, table, initialPayload) {
  let payload = { ...initialPayload };

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase.from(table).insert([payload]).select().single();
    if (!error) return data;

    const msg = error.message || "";

    // Column present/absent permutations
    if (/column .*company_id.* does not exist/i.test(msg)) { payload = omit(payload, "company_id"); continue; }
    if (/null value in column .*company_id.* violates/i.test(msg)) {
      throw new Error(`This CRM requires company_id on ${table}. Link the entity to a company or relax NOT NULL on ${table}.company_id.`);
    }
    if (/column .*author.* does not exist/i.test(msg) && "author" in payload) { payload = { ...omit(payload, "author"), created_by: initialPayload.author || "mcp" }; continue; }
    if (/column .*created_by.* does not exist/i.test(msg) && "created_by" in payload) { payload = omit(payload, "created_by"); continue; }
    if (/column .*activity_date.* does not exist/i.test(msg) && "activity_date" in payload) {
      const when = payload.activity_date; payload = { ...omit(payload, "activity_date"), created_at: when }; continue;
    }
    if (/column .*created_at.* does not exist/i.test(msg) && "created_at" in payload) { payload = omit(payload, "created_at"); continue; }
    if (/column .*body.* does not exist/i.test(msg) && "body" in payload) { const t = payload.body; payload = { ...omit(payload, "body"), content: t }; continue; }
    if (/column .*content.* does not exist/i.test(msg) && "content" in payload) { payload = omit(payload, "content"); continue; }
    if (/column .*type.* does not exist/i.test(msg) && "type" in payload) { payload = omit(payload, "type"); continue; }

    friendlySupabaseError(table, error);
  }

  throw new Error(`Failed to insert into ${table} after multiple attempts.`);
}

async function getCompanyIdFrom(supabase, table, id) {
  const r = await supabase.from(table).select("company_id").eq("id", id).maybeSingle();
  if (r?.error) {
    // If the entity table doesn't even have company_id, just ignore
    if (/column .*company_id.* does not exist/i.test(r.error.message)) return null;
    throw new Error(`${table} lookup failed: ${r.error.message}`);
  }
  return r?.data?.company_id ?? null;
}

/**
 * Register all CRM tools on the MCP server
 * @param {McpServer} server - The MCP server instance
 * @param {Object} supabase - The Supabase client instance
 */
export function registerCrmTools(server, supabase) {
  
  // ---------- WRITE TOOLS ----------

  // 0) Generic update tools (contacts, companies, leads, deals)
  server.registerTool(
    "crm_update_contact",
    {
      title: "Update contact (generic)",
      description: "Update any allowed fields on a contact.",
      inputSchema: {
        contact_id: z.string().uuid(),
        updates: z.record(z.any())
      }
    },
    async ({ contact_id, updates }) => {
      const allowed = [
        "first_name","last_name","email","phone","company_id","title","notes","full_name"
      ];
      const patch = sanitizeUpdates(updates, allowed);
      if (Object.keys(patch).length === 0) return ok("No valid fields to update.");
      const { data, error } = await supabase
        .from("contacts")
        .update(patch)
        .eq("id", contact_id)
        .select()
        .single();
      if (error) friendlySupabaseError("contacts", error);
      return ok(`Updated contact ${contact_id}.`, data);
    }
  );

  server.registerTool(
    "crm_update_company",
    {
      title: "Update company (generic)",
      description: "Update any allowed fields on a company.",
      inputSchema: {
        company_id: z.string().uuid(),
        updates: z.record(z.any())
      }
    },
    async ({ company_id, updates }) => {
      const allowed = [
        "name","website","phone","address","industry","notes"
      ];
      const patch = sanitizeUpdates(updates, allowed);
      if (Object.keys(patch).length === 0) return ok("No valid fields to update.");
      const { data, error } = await supabase
        .from("companies")
        .update(patch)
        .eq("id", company_id)
        .select()
        .single();
      if (error) friendlySupabaseError("companies", error);
      return ok(`Updated company ${company_id}.`, data);
    }
  );

  server.registerTool(
    "crm_update_lead",
    {
      title: "Update lead (generic)",
      description: "Update any allowed fields on a lead.",
      inputSchema: {
        lead_id: z.string().uuid(),
        updates: z.record(z.any())
      }
    },
    async ({ lead_id, updates }) => {
      const allowed = [
        "first_name","last_name","email","phone","company","source","status","message"
      ];
      const patch = sanitizeUpdates(updates, allowed);
      if (Object.keys(patch).length === 0) return ok("No valid fields to update.");
      const { data, error } = await supabase
        .from("leads")
        .update(patch)
        .eq("id", lead_id)
        .select()
        .single();
      if (error) friendlySupabaseError("leads", error);
      return ok(`Updated lead ${lead_id}.`, data);
    }
  );

  server.registerTool(
    "crm_update_deal_generic",
    {
      title: "Update deal (generic)",
      description: "Update any allowed fields on a deal.",
      inputSchema: {
        deal_id: z.string().uuid(),
        updates: z.record(z.any())
      }
    },
    async ({ deal_id, updates }) => {
      const allowed = [
        "title","status","amount","stage_id","pipeline_id","company_id","contact_person_id","notes"
      ];
      const patch = sanitizeUpdates(updates, allowed);
      if (Object.keys(patch).length === 0) return ok("No valid fields to update.");
      const { data, error } = await supabase
        .from("deals")
        .update(patch)
        .eq("id", deal_id)
        .select()
        .single();
      if (error) friendlySupabaseError("deals", error);
      return ok(`Updated deal ${deal_id}.`, data);
    }
  );


  // 1) Create a contact
  server.registerTool(
    "crm_create_contact",
    {
      title: "Create contact",
      description: "Create a new contact record.",
      inputSchema: {
        first_name: z.string().min(1),
        last_name: z.string().min(1),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        company_id: z.string().uuid().optional()
      }
    },
    async ({ first_name, last_name, email, phone, company_id }) => {
      const { data, error } = await supabase
        .from("contacts")
        .insert([{ first_name, last_name, email, phone, company_id: company_id ?? null }])
        .select()
        .single();
      if (error) friendlySupabaseError("contacts", error);
      return ok(`Created contact ${data.id} (${data.first_name} ${data.last_name}).`, data);
    }
  );

  // 2) Upsert a company
  server.registerTool(
    "crm_upsert_company",
    {
      title: "Upsert company",
      description: "Create or update a company by name.",
      inputSchema: {
        name: z.string().min(1),
        website: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional()
      }
    },
    async ({ name, website, phone, address }) => {
      const values = { name, website, phone, address };
      const { data, error } = await supabase
        .from("companies")
        .upsert(values, { onConflict: "name", ignoreDuplicates: false })
        .select()
        .single();
      if (error) friendlySupabaseError("companies", error);
      return ok(`Upserted company ${data.id} (${data.name}).`, data);
    }
  );

  // 3) Update a deal's stage/status/amount
  server.registerTool(
    "crm_update_deal",
    {
      title: "Update deal",
      description: "Update a deal's stage and status.",
      inputSchema: {
        deal_id: z.string().uuid(),
        stage_id: z.string().uuid().optional(),
        status: z.string().optional(),
        amount: z.number().optional()
      }
    },
    async ({ deal_id, stage_id, status, amount }) => {
      const patch = {};
      if (stage_id) patch.stage_id = stage_id;
      if (status) patch.status = status;
      if (amount !== undefined) patch.amount = amount;

      const { data, error } = await supabase
        .from("deals")
        .update(patch)
        .eq("id", deal_id)
        .select()
        .single();
      if (error) friendlySupabaseError("deals", error);
      return ok(`Updated deal ${deal_id}.`, data);
    }
  );

  // 4) Add a note to a deal
  server.registerTool(
    "crm_add_deal_note",
    {
      title: "Add deal note",
      description: "Add a note to a deal.",
      inputSchema: { deal_id: z.string().uuid(), body: z.string().min(1), author: z.string().optional() }
    },
    async ({ deal_id, body, author = "Claude via MCP" }) => {
      const company_id = await getCompanyIdFrom(supabase, "deals", deal_id);
      const base = { deal_id, body, author, type: "note", activity_date: new Date().toISOString(), ...(company_id ? { company_id } : {}) };
      const data = await smartInsertNote(supabase, "deal_notes", base);
      return ok(`Added note to deal ${deal_id}.`, data);
    }
  );

  // 5) Add a note to a lead
  server.registerTool(
    "crm_add_lead_note",
    {
      title: "Add lead note",
      description: "Add a note to a lead.",
      inputSchema: { lead_id: z.string().uuid(), body: z.string().min(1), author: z.string().optional() }
    },
    async ({ lead_id, body, author = "Claude via MCP" }) => {
      const company_id = await getCompanyIdFrom(supabase, "leads", lead_id); // may resolve to null if column doesn't exist
      const base = { lead_id, body, author, type: "note", activity_date: new Date().toISOString(), ...(company_id ? { company_id } : {}) };
      const data = await smartInsertNote(supabase, "lead_notes", base);
      return ok(`Added note to lead ${lead_id}.`, data);
    }
  );

  // 6) Add a note to a contact
  server.registerTool(
    "crm_add_contact_note",
    {
      title: "Add contact note",
      description: "Add a note to a contact.",
      inputSchema: { contact_id: z.string().uuid(), body: z.string().min(1), author: z.string().optional() }
    },
    async ({ contact_id, body, author = "Claude via MCP" }) => {
      const company_id = await getCompanyIdFrom(supabase, "contacts", contact_id);
      const base = { contact_id, body, author, type: "note", activity_date: new Date().toISOString(), ...(company_id ? { company_id } : {}) };
      const data = await smartInsertNote(supabase, "contact_notes", base);
      return ok(`Added note to contact ${contact_id}.`, data);
    }
  );

  // 7) Add a note to a company
  server.registerTool(
    "crm_add_company_note",
    {
      title: "Add company note",
      description: "Add a note to a company.",
      inputSchema: { company_id: z.string().uuid(), body: z.string().min(1), author: z.string().optional() }
    },
    async ({ company_id, body, author = "Claude via MCP" }) => {
      const base = { company_id, body, author, type: "note", activity_date: new Date().toISOString() };
      const data = await smartInsertNote(supabase, "company_notes", base);
      return ok(`Added note to company ${company_id}.`, data);
    }
  );

  // 8) Add note (generic alias to prevent "Method not found")
  server.registerTool(
    "crm_add_note",
    {
      title: "Add note (generic)",
      description: "Attach a note to contact/company/deal/lead.",
      inputSchema: {
        entity_type: z.enum(["contact","company","deal","lead"]),
        entity_id: z.string().uuid(),
        body: z.string().min(1),
        author: z.string().optional()
      }
    },
    async ({ entity_type, entity_id, body, author = "Claude via MCP" }) => {
      if (entity_type === "company") {
        const base = { company_id: entity_id, body, author, type: "note", activity_date: new Date().toISOString() };
        const data = await smartInsertNote(supabase, "company_notes", base);
        return ok(`Added note to company ${entity_id}.`, data);
      }

      const company_id = await getCompanyIdFrom(
        supabase,
        entity_type === "contact" ? "contacts" : entity_type === "deal" ? "deals" : "leads",
        entity_id
      );

      const base = {
        [`${entity_type}_id`]: entity_id,
        body, author, type: "note",
        activity_date: new Date().toISOString(),
        ...(company_id ? { company_id } : {})
      };

      const table = `${entity_type}_notes`; // contact_notes / deal_notes / lead_notes
      const data = await smartInsertNote(supabase, table, base);
      return ok(`Added note to ${entity_type} ${entity_id}.`, data);
    }
  );

  // ---------- READ/SEARCH TOOLS ----------

  // 9) Create a lead
  server.registerTool(
    "crm_create_lead",
    {
      title: "Create lead",
      description: "Create a new lead record.",
      inputSchema: {
        first_name: z.string().min(1),
        last_name: z.string().min(1),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        company: z.string().optional(),
        source: z.string().optional(),
        status: z.string().optional(),
        message: z.string().optional()
      }
    },
    async ({ first_name, last_name, email, phone, company, source, status, message }) => {
      const { data, error } = await supabase
        .from("leads")
        .insert([{
          first_name,
          last_name,
          email,
          phone,
          company,
          source: source ?? "mcp",
          status: status ?? "new",
          message
        }])
        .select()
        .single();
      if (error) friendlySupabaseError("leads", error);
      return ok(`Created lead ${data.id} (${data.first_name} ${data.last_name}).`, data);
    }
  );

  // 10) Update lead status
  server.registerTool(
    "crm_update_lead_status",
    {
      title: "Update lead status",
      description: "Update a lead's status.",
      inputSchema: {
        lead_id: z.string().uuid(),
        status: z.string().min(1)
      }
    },
    async ({ lead_id, status }) => {
      const { data, error } = await supabase
        .from("leads")
        .update({ status })
        .eq("id", lead_id)
        .select()
        .single();
      if (error) friendlySupabaseError("leads", error);
      return ok(`Updated lead ${lead_id} status to "${data.status}".`, data);
    }
  );

  // 11) Search contacts
  server.registerTool(
    "crm_search_contacts",
    {
      title: "Search contacts",
      description: "Search for contacts by name or email.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().min(1).max(100).optional()
      }
    },
    async ({ query, limit = 10 }) => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`)
        .limit(limit);
      if (error) friendlySupabaseError("contacts", error);
      return ok(`Found ${data.length} contacts matching "${query}".`, data);
    }
  );

  // 12) Search companies
  server.registerTool(
    "crm_search_companies",
    {
      title: "Search companies",
      description: "Search for companies by name.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().min(1).max(100).optional()
      }
    },
    async ({ query, limit = 10 }) => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .ilike("name", `%${query}%`)
        .limit(limit);
      if (error) friendlySupabaseError("companies", error);
      return ok(`Found ${data.length} companies matching "${query}".`, data);
    }
  );

  // 13) Search deals
  server.registerTool(
    "crm_search_deals",
    {
      title: "Search deals",
      description: "Search for deals by title, company, or contact person.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().min(1).max(100).optional()
      }
    },
    async ({ query, limit = 10 }) => {
      // Escape special characters in the query to prevent SQL injection
      const escapedQuery = query.replace(/[%_\\]/g, '\\$&');

      const { data, error } = await supabase
        .from("deals")
        .select(`
          *,
          companies!deals_company_id_fkey (id, name),
          contacts:contact_person_id (id, first_name, last_name, full_name),
          pipeline_stages:stage_id (id, code, name, pipeline_id),
          pipelines!deals_pipeline_id_fkey (id, code, name)
        `)
        .or(`title.ilike.%${escapedQuery}%,companies.name.ilike.%${escapedQuery}%,contacts.full_name.ilike.%${escapedQuery}%`)
        .limit(limit);

      if (error) {
        // If the complex query fails, try a simpler approach
        if (error.message.includes('relation') || error.message.includes('column')) {
          const { data: simpleData, error: simpleError } = await supabase
            .from("deals")
            .select("*, companies!deals_company_id_fkey (id, name)")
            .ilike("title", `%${escapedQuery}%`)
            .limit(limit);

          if (simpleError) friendlySupabaseError("deals", simpleError);
          return ok(`Found ${simpleData.length} deals matching "${query}".`, simpleData);
        }
        friendlySupabaseError("deals", error);
      }

      return ok(`Found ${data.length} deals matching "${query}".`, data);
    }
  );

  // 14) Search leads
  server.registerTool(
    "crm_search_leads",
    {
      title: "Search leads",
      description: "Search for leads by name, email, or company.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().min(1).max(100).optional()
      }
    },
    async ({ query, limit = 10 }) => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,company.ilike.%${query}%`)
        .limit(limit);
      if (error) friendlySupabaseError("leads", error);
      return ok(`Found ${data.length} leads matching "${query}".`, data);
    }
  );

  // 15) Get deals by contact ID
  server.registerTool(
    "crm_get_deals_by_contact",
    {
      title: "Get deals by contact",
      description: "Get all deals associated with a specific contact ID.",
      inputSchema: {
        contact_id: z.string().uuid(),
        limit: z.number().min(1).max(100).optional()
      }
    },
    async ({ contact_id, limit = 50 }) => {
      // First try to get deals where contact_person_id matches (individual deals)
      const { data: directDeals, error: directError } = await supabase
        .from("deals")
        .select("*, companies!deals_company_id_fkey (id, name), pipeline_stages:stage_id (id, code, name, pipeline_id), pipelines!deals_pipeline_id_fkey (id, code, name)")
        .eq("contact_person_id", contact_id)
        .limit(limit);

      if (directError) friendlySupabaseError("deals", directError);

      // Then try to get deals through the deal_contacts junction table
      const { data: junctionDeals, error: junctionError } = await supabase
        .from("deal_contacts")
        .select("deals:deal_id (*, companies!deals_company_id_fkey (id, name), pipeline_stages:stage_id (id, code, name, pipeline_id), pipelines!deals_pipeline_id_fkey (id, code, name))")
        .eq("contact_id", contact_id)
        .limit(limit);

      if (junctionError) {
        // If deal_contacts table doesn't exist, just return direct deals
        if (/relation.*deal_contacts.*does not exist/i.test(junctionError.message)) {
          return ok(`Found ${directDeals?.length || 0} deals for contact ${contact_id}.`, directDeals || []);
        }
        friendlySupabaseError("deal_contacts", junctionError);
      }

      // Combine and deduplicate deals
      const allDeals = [...(directDeals || [])];
      const junctionDealIds = new Set(allDeals.map(d => d.id));

      if (junctionDeals) {
        for (const junctionDeal of junctionDeals) {
          if (junctionDeal.deals && !junctionDealIds.has(junctionDeal.deals.id)) {
            allDeals.push(junctionDeal.deals);
          }
        }
      }

      return ok(`Found ${allDeals.length} deals for contact ${contact_id}.`, allDeals);
    }
  );

  // 16) Get contact deal associations
  server.registerTool(
    "crm_get_contact_deal_associations",
    {
      title: "Get contact deal associations",
      description: "Get detailed information about how a contact is associated with deals.",
      inputSchema: {
        contact_id: z.string().uuid()
      }
    },
    async ({ contact_id }) => {
      const associations = {
        contact_id,
        direct_deals: [],
        junction_deals: [],
        total_deals: 0
      };

      // Get direct deals (contact_person_id)
      const { data: directDeals, error: directError } = await supabase
        .from("deals")
        .select("id, title, status, amount, contact_person_id, created_at")
        .eq("contact_person_id", contact_id);

      if (!directError && directDeals) {
        associations.direct_deals = directDeals;
      }

      // Get junction table deals
      const { data: junctionDeals, error: junctionError } = await supabase
        .from("deal_contacts")
        .select("deal_id, is_main_contact, role_at_deal, deals:deal_id (id, title, status, amount, created_at)")
        .eq("contact_id", contact_id);

      if (!junctionError && junctionDeals) {
        associations.junction_deals = junctionDeals;
      }

      associations.total_deals = associations.direct_deals.length + associations.junction_deals.length;

      return ok(`Found ${associations.total_deals} deal associations for contact ${contact_id}.`, associations);
    }
  );

  // 17) Cancel/Lost deal
  server.registerTool(
    "crm_cancel_deal",
    {
      title: "Cancel deal",
      description: "Move a deal to cancelled/lost status.",
      inputSchema: {
        deal_id: z.string().uuid(),
        status: z.enum(["cancelled", "lost", "closed_lost"]).optional(),
        reason: z.string().optional()
      }
    },
    async ({ deal_id, status = "cancelled", reason }) => {
      const updateData = { status };
      if (reason) {
        updateData.notes = reason;
      }

      const { data, error } = await supabase
        .from("deals")
        .update(updateData)
        .eq("id", deal_id)
        .select()
        .single();

      if (error) friendlySupabaseError("deals", error);

      const message = reason
        ? `Deal ${deal_id} moved to ${status} status. Reason: ${reason}`
        : `Deal ${deal_id} moved to ${status} status.`;

      return ok(message, data);
    }
  );

  // 18) List deals by contact (alias for easier access)
  server.registerTool(
    "crm_list_contact_deals",
    {
      title: "List contact deals",
      description: "List all deals for a specific contact (alias for crm_get_deals_by_contact).",
      inputSchema: {
        contact_id: z.string().uuid(),
        limit: z.number().min(1).max(100).optional()
      }
    },
    async ({ contact_id, limit = 50 }) => {
      // Reuse the get_deals_by_contact function
      const { data: directDeals, error: directError } = await supabase
        .from("deals")
        .select("*, companies!deals_company_id_fkey (id, name), pipeline_stages:stage_id (id, code, name, pipeline_id), pipelines!deals_pipeline_id_fkey (id, code, name)")
        .eq("contact_person_id", contact_id)
        .limit(limit);

      if (directError) friendlySupabaseError("deals", directError);

      const { data: junctionDeals, error: junctionError } = await supabase
        .from("deal_contacts")
        .select("deals:deal_id (*, companies!deals_company_id_fkey (id, name), pipeline_stages:stage_id (id, code, name, pipeline_id), pipelines!deals_pipeline_id_fkey (id, code, name))")
        .eq("contact_id", contact_id)
        .limit(limit);

      if (junctionError && !/relation.*deal_contacts.*does not exist/i.test(junctionError.message)) {
        friendlySupabaseError("deal_contacts", junctionError);
      }

      const allDeals = [...(directDeals || [])];
      const junctionDealIds = new Set(allDeals.map(d => d.id));

      if (junctionDeals) {
        for (const junctionDeal of junctionDeals) {
          if (junctionDeal.deals && !junctionDealIds.has(junctionDeal.deals.id)) {
            allDeals.push(junctionDeal.deals);
          }
        }
      }

      return ok(`Found ${allDeals.length} deals for contact ${contact_id}.`, allDeals);
    }
  );

  // ---------- LINKING / ASSOCIATION TOOLS ----------

  // Link a contact to a company (set contact.company_id)
  server.registerTool(
    "crm_link_contact_company",
    {
      title: "Link contact to company",
      description: "Associate a contact with a company by setting company_id on the contact.",
      inputSchema: {
        contact_id: z.string().uuid(),
        company_id: z.string().uuid()
      }
    },
    async ({ contact_id, company_id }) => {
      const { data, error } = await supabase
        .from("contacts")
        .update({ company_id })
        .eq("id", contact_id)
        .select()
        .single();
      if (error) friendlySupabaseError("contacts", error);
      return ok(`Linked contact ${contact_id} to company ${company_id}.`, data);
    }
  );

  // Unlink a contact from any company (set contact.company_id = null)
  server.registerTool(
    "crm_unlink_contact_company",
    {
      title: "Unlink contact from company",
      description: "Remove a contact's association with its company (sets company_id to null).",
      inputSchema: {
        contact_id: z.string().uuid()
      }
    },
    async ({ contact_id }) => {
      const { data, error } = await supabase
        .from("contacts")
        .update({ company_id: null })
        .eq("id", contact_id)
        .select()
        .single();
      if (error) friendlySupabaseError("contacts", error);
      return ok(`Unlinked contact ${contact_id} from any company.`, data);
    }
  );

  // Link a contact to a deal via junction table, with optional role
  server.registerTool(
    "crm_link_contact_deal",
    {
      title: "Link contact to deal",
      description: "Associate a contact with a deal (creates row in deal_contacts).",
      inputSchema: {
        contact_id: z.string().uuid(),
        deal_id: z.string().uuid(),
        is_main_contact: z.boolean().optional(),
        role_at_deal: z.string().optional()
      }
    },
    async ({ contact_id, deal_id, is_main_contact = false, role_at_deal }) => {
      // Try insert; if table missing, fallback to updating contact_person_id on deals
      const { data, error } = await supabase
        .from("deal_contacts")
        .insert([{ contact_id, deal_id, is_main_contact, role_at_deal }])
        .select()
        .maybeSingle();

      if (error) {
        if (/relation.*deal_contacts.*does not exist/i.test(error.message)) {
          const { data: deal, error: dErr } = await supabase
            .from("deals")
            .update({ contact_person_id: contact_id })
            .eq("id", deal_id)
            .select()
            .single();
          if (dErr) friendlySupabaseError("deals", dErr);
          return ok(`Linked contact ${contact_id} to deal ${deal_id} (via deals.contact_person_id).`, deal);
        }
        friendlySupabaseError("deal_contacts", error);
      }
      return ok(`Linked contact ${contact_id} to deal ${deal_id}.`, data);
    }
  );

  // Link a company to a deal (set deals.company_id)
  server.registerTool(
    "crm_link_company_deal",
    {
      title: "Link company to deal",
      description: "Associate a company to a deal by setting company_id on the deal.",
      inputSchema: {
        company_id: z.string().uuid(),
        deal_id: z.string().uuid()
      }
    },
    async ({ company_id, deal_id }) => {
      const { data, error } = await supabase
        .from("deals")
        .update({ company_id })
        .eq("id", deal_id)
        .select()
        .single();
      if (error) friendlySupabaseError("deals", error);
      return ok(`Linked company ${company_id} to deal ${deal_id}.`, data);
    }
  );

  // Unlink a contact from a deal
  server.registerTool(
    "crm_unlink_contact_deal",
    {
      title: "Unlink contact from deal",
      description: "Remove an association between a contact and a deal.",
      inputSchema: {
        contact_id: z.string().uuid(),
        deal_id: z.string().uuid()
      }
    },
    async ({ contact_id, deal_id }) => {
      // Prefer junction table deletion when present
      const del = await supabase
        .from("deal_contacts")
        .delete()
        .eq("contact_id", contact_id)
        .eq("deal_id", deal_id);

      if (del.error) {
        if (/relation.*deal_contacts.*does not exist/i.test(del.error.message)) {
          // Fallback: clear deals.contact_person_id if it matches
          const { data: deal, error: dErr } = await supabase
            .from("deals")
            .update({ contact_person_id: null })
            .eq("id", deal_id)
            .eq("contact_person_id", contact_id)
            .select()
            .maybeSingle();
          if (dErr) friendlySupabaseError("deals", dErr);
          return ok(`Unlinked contact ${contact_id} from deal ${deal_id} (fallback).`, deal || null);
        }
        friendlySupabaseError("deal_contacts", del.error);
      }

      return ok(`Unlinked contact ${contact_id} from deal ${deal_id}.`);
    }
  );

  // Unlink company from a deal (set deals.company_id = null)
  server.registerTool(
    "crm_unlink_company_deal",
    {
      title: "Unlink company from deal",
      description: "Remove company association on a deal.",
      inputSchema: {
        deal_id: z.string().uuid()
      }
    },
    async ({ deal_id }) => {
      const { data, error } = await supabase
        .from("deals")
        .update({ company_id: null })
        .eq("id", deal_id)
        .select()
        .single();
      if (error) friendlySupabaseError("deals", error);
      return ok(`Unlinked company from deal ${deal_id}.`, data);
    }
  );
}
