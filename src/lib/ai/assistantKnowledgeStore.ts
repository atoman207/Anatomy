import "server-only";

import { createAdminSupabase } from "@/lib/supabase/server";
import {
  builtinKnowledge,
  retrieveKnowledge,
  type KnowledgeDocument,
} from "./assistantKnowledge";

/**
 * Knowledge documents for the assistant: built-ins plus rows from the
 * Supabase table `assistant_knowledge_documents` (FAQ, announcements, anything
 * editors add without a deploy).
 *
 * The table is optional. Until the migration is applied, or when the service
 * key is missing, the assistant runs on the built-in documents alone.
 */

const CACHE_MS = 5 * 60_000;
let cache: { at: number; docs: KnowledgeDocument[] } | null = null;

async function loadDatabaseDocuments(): Promise<KnowledgeDocument[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.docs;
  let docs: KnowledgeDocument[] = [];
  try {
    const admin = createAdminSupabase();
    // The table is not in the generated types until the migration is applied.
    const { data, error } = await (admin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: boolean) => {
            limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
          };
        };
      };
    })
      .from("assistant_knowledge_documents")
      .select("id, category, title, body, keywords")
      .eq("published", true)
      .limit(500);
    if (!error && data) {
      docs = data.map((row) => ({
        id: `db:${String(row.id)}`,
        category: String(row.category ?? "faq"),
        title: String(row.title ?? ""),
        body: String(row.body ?? ""),
        keywords: Array.isArray(row.keywords) ? row.keywords.map(String) : [],
      }));
    }
  } catch {
    // Missing env or table: built-ins only.
  }
  cache = { at: Date.now(), docs };
  return docs;
}

/**
 * Documents to put in front of the model for this conversation.
 *
 * The query is the latest user turn plus the one before it, so a follow-up
 * like 「それはいくらですか？」 still retrieves what "それ" referred to.
 */
export async function knowledgeForConversation(
  userTurns: string[],
  limit = 5,
): Promise<KnowledgeDocument[]> {
  const docs = [...builtinKnowledge(), ...(await loadDatabaseDocuments())];
  const query = userTurns.slice(-2).join(" ");
  const hits = retrieveKnowledge(query, docs, limit).map((r) => r.doc);
  // Always ground the answer in what LABNOTE is, even for off-topic openers.
  const overview = docs.find((d) => d.id === "overview");
  if (overview && !hits.includes(overview)) hits.unshift(overview);
  return hits;
}

/** Every knowledge document (built-in + database), e.g. for versioning caches. */
export async function allKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  return [...builtinKnowledge(), ...(await loadDatabaseDocuments())];
}
