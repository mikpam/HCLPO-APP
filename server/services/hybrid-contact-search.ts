import OpenAI from "openai";
import { db } from "../db";
import { contacts } from "../../shared/schema";
import { eq, ilike, sql, and, or } from "drizzle-orm";
import { contactEmbeddingService } from "./contact-embedding";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
  return new OpenAI({ apiKey });
}

interface ContactSearchInput {
  name?: string;
  email?: string;
  jobTitle?: string;
  phone?: string;
  company?: string; // If available from context
}

interface ContactSearchResult {
  contact?: any;
  confidence: number;
  method: 'exact_email' | 'domain_company' | 'semantic' | 'not_found';
  similarityScore?: number;
  domainBonus?: number;
  aliasBonus?: number;
  alternatives?: any[]; // Top alternative matches for audit
  reason: string;
}

export class HybridContactSearchService {
  private openai: OpenAI;

  constructor() {
    this.openai = getOpenAIClient();
  }

  /**
   * Normalize email to local@domain format
   */
  private normalizeEmail(email?: string): string | null {
    if (!email || typeof email !== 'string') return null;
    
    const cleanEmail = email.trim().toLowerCase();
    // Extract email from angle brackets if present
    const emailMatch = cleanEmail.match(/<([^<>]+@[^<>]+)>/);
    const finalEmail = emailMatch ? emailMatch[1] : cleanEmail;
    
    if (!finalEmail.includes('@')) return null;
    return finalEmail;
  }

  /**
   * Extract domain from email
   */
  private extractDomain(email?: string): string | undefined {
    const normalized = this.normalizeEmail(email);
    if (!normalized) return undefined;
    return normalized.split('@')[1] || undefined;
  }

  /**
   * Step 1: Deterministic gate - exact email match
   */
  private async findByExactEmail(email: string): Promise<any | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail) return null;

    console.log(`   🎯 Deterministic gate: Searching for exact email "${normalizedEmail}"`);

    const results = await db
      .select()
      .from(contacts)
      .where(eq(sql`lower(${contacts.email})`, normalizedEmail))
      .limit(1);

    if (results.length > 0) {
      console.log(`   ✅ Found exact email match: ${results[0].name} (${results[0].email})`);
      return results[0];
    }

    console.log(`   ❌ No exact email match found`);
    return null;
  }

  /**
   * Step 2: Domain + company matching for disambiguation
   */
  private async findByDomainAndCompany(email?: string, company?: string): Promise<any[]> {
    const domain = this.extractDomain(email);
    if (!domain && !company) return [];

    console.log(`   🔍 Domain+Company search: domain="${domain}", company="${company}"`);

    let query = db.select().from(contacts);
    const conditions = [];

    if (domain) {
      conditions.push(eq(sql`lower(split_part(${contacts.email}, '@', 2))`, domain));
    }

    if (company) {
      conditions.push(ilike(contacts.name, `%${company}%`));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const results = await query.limit(10);
    console.log(`   📊 Found ${results.length} domain+company matches`);
    return results;
  }

  /**
   * Step 3: Semantic search using vector similarity
   */
  private async findBySemantic(input: ContactSearchInput, domainFilter?: string): Promise<any[]> {
    console.log(`   🔮 Semantic search with domain filter: "${domainFilter}"`);

    // Build search text similar to contact_text format
    const searchParts = [];
    if (input.name) searchParts.push(input.name);
    if (input.jobTitle) searchParts.push(input.jobTitle);
    if (input.email) searchParts.push(input.email);
    if (input.company) searchParts.push(input.company);
    if (input.phone) searchParts.push(input.phone);

    const searchText = searchParts.join(" | ");
    console.log(`   📝 Search text: "${searchText}"`);

    // Generate embedding for search text
    const embedding = await this.generateSearchEmbedding(searchText);
    console.log(`   🔢 Generated search embedding (${embedding.length} dimensions)`);

    // Use direct SQL with proper vector formatting  
    const vectorStr = `[${embedding.join(',')}]`;
    
    let query: string;
    let values: any[];
    
    if (domainFilter) {
      query = `
        SELECT 
          id, netsuite_internal_id, name, job_title, phone, email, 
          inactive, duplicate, login_access, contact_text,
          1 - (contact_embedding <=> $1::vector) AS cosine_similarity
        FROM contacts 
        WHERE contact_embedding IS NOT NULL
          AND lower(split_part(email, '@', 2)) = $2
        ORDER BY contact_embedding <=> $1::vector 
        LIMIT 15
      `;
      values = [vectorStr, domainFilter];
    } else {
      query = `
        SELECT 
          id, netsuite_internal_id, name, job_title, phone, email, 
          inactive, duplicate, login_access, contact_text,
          1 - (contact_embedding <=> $1::vector) AS cosine_similarity
        FROM contacts 
        WHERE contact_embedding IS NOT NULL
        ORDER BY contact_embedding <=> $1::vector 
        LIMIT 15
      `;
      values = [vectorStr];
    }

    // Use direct database client for vector operations
    try {
      const result = await db.execute(sql.raw(query, values));
      console.log(`   📊 Found ${result.rows.length} semantic matches`);
      return result.rows as any[];
    } catch (error) {
      console.error(`   ❌ Vector search failed:`, error);
      // Fallback to basic text search
      const fallbackQuery = `
        SELECT id, netsuite_internal_id, name, job_title, phone, email, 
               inactive, duplicate, login_access, contact_text,
               0.5 AS cosine_similarity
        FROM contacts 
        WHERE contact_text ILIKE $1
        LIMIT 5
      `;
      const result = await db.execute(sql.raw(fallbackQuery, [`%${searchText}%`]));
      console.log(`   📊 Fallback search found ${result.rows.length} text matches`);
      return result.rows as any[];
    }
  }

  /**
   * Generate embedding for search text
   */
  private async generateSearchEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error("Error generating search embedding:", error);
      throw error;
    }
  }

  /**
   * Step 4: Rerank and apply business rules
   */
  private rerank(candidates: any[], input: ContactSearchInput): any[] {
    const domain = this.extractDomain(input.email);
    
    return candidates.map(candidate => {
      const cosine_sim = candidate.cosine_similarity || 0;
      
      // Domain bonus (20%)
      let domain_bonus = 0;
      if (domain && this.extractDomain(candidate.email) === domain) {
        domain_bonus = 0.2;
      }
      
      // Alias bonus (10%) - basic name similarity
      let alias_bonus = 0;
      if (input.name && candidate.name) {
        const nameSim = this.calculateNameSimilarity(input.name, candidate.name);
        alias_bonus = nameSim * 0.1;
      }
      
      // Final score: 70% cosine + 20% domain + 10% alias
      const final_score = (cosine_sim * 0.7) + domain_bonus + (alias_bonus);
      
      return {
        ...candidate,
        final_score,
        cosine_sim,
        domain_bonus,
        alias_bonus
      };
    }).sort((a, b) => b.final_score - a.final_score);
  }

  /**
   * Basic name similarity calculation
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();
    
    if (n1 === n2) return 1.0;
    if (n1.includes(n2) || n2.includes(n1)) return 0.8;
    
    // Basic Levenshtein-like similarity
    const maxLen = Math.max(n1.length, n2.length);
    if (maxLen === 0) return 1.0;
    
    let matches = 0;
    const minLen = Math.min(n1.length, n2.length);
    for (let i = 0; i < minLen; i++) {
      if (n1[i] === n2[i]) matches++;
    }
    
    return matches / maxLen;
  }

  /**
   * Main hybrid search method implementing the full flow
   */
  async searchContact(input: ContactSearchInput): Promise<ContactSearchResult> {
    console.log(`🔍 HYBRID CONTACT SEARCH: Starting search with input:`, input);

    try {
      // Step 1: Deterministic gate - exact email match
      if (input.email) {
        const exactMatch = await this.findByExactEmail(input.email);
        if (exactMatch) {
          return {
            contact: exactMatch,
            confidence: 1.0,
            method: 'exact_email',
            reason: 'Found exact email match',
            alternatives: []
          };
        }
      }

      // Step 2: Domain + company matching
      const domainCompanyMatches = await this.findByDomainAndCompany(input.email, input.company);
      if (domainCompanyMatches.length === 1) {
        // Single unambiguous match
        return {
          contact: domainCompanyMatches[0],
          confidence: 0.9,
          method: 'domain_company',
          reason: 'Single domain+company match',
          alternatives: []
        };
      } else if (domainCompanyMatches.length > 1) {
        // Multiple matches - might need semantic disambiguation
        console.log(`   ⚠️  Multiple domain+company matches (${domainCompanyMatches.length}), proceeding to semantic search`);
      }

      // Step 3: Semantic search for disambiguation or broader search
      const domain = this.extractDomain(input.email);
      const semanticMatches = await this.findBySemantic(input, domain);
      
      if (semanticMatches.length === 0) {
        return {
          confidence: 0,
          method: 'not_found',
          reason: 'No semantic matches found',
          alternatives: []
        };
      }

      // Step 4: Rerank with business rules
      const rankedMatches = this.rerank(semanticMatches, input);
      const topMatch = rankedMatches[0];
      const alternatives = rankedMatches.slice(1, 5); // Top 4 alternatives

      // Step 5: Apply confidence thresholds
      if (topMatch.final_score >= 0.85) {
        return {
          contact: topMatch,
          confidence: topMatch.final_score,
          method: 'semantic',
          similarityScore: topMatch.cosine_sim,
          domainBonus: topMatch.domain_bonus,
          aliasBonus: topMatch.alias_bonus,
          reason: `High confidence semantic match (score: ${topMatch.final_score.toFixed(3)})`,
          alternatives
        };
      } else if (topMatch.final_score >= 0.75) {
        return {
          contact: topMatch,
          confidence: topMatch.final_score,
          method: 'semantic',
          similarityScore: topMatch.cosine_sim,
          domainBonus: topMatch.domain_bonus,
          aliasBonus: topMatch.alias_bonus,
          reason: `Medium confidence semantic match (score: ${topMatch.final_score.toFixed(3)}) - requires second corroborator`,
          alternatives
        };
      } else {
        return {
          confidence: topMatch.final_score,
          method: 'semantic',
          similarityScore: topMatch.cosine_sim,
          domainBonus: topMatch.domain_bonus,
          aliasBonus: topMatch.alias_bonus,
          reason: `Low confidence match (score: ${topMatch.final_score.toFixed(3)}) - punt to CSR review`,
          alternatives: rankedMatches.slice(0, 5) // Include top candidate in alternatives for CSR
        };
      }

    } catch (error) {
      console.error(`   ❌ Hybrid search error:`, error);
      return {
        confidence: 0,
        method: 'not_found',
        reason: `Search error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        alternatives: []
      };
    }
  }

  /**
   * Health check to verify embeddings are available
   */
  async checkEmbeddingHealth(): Promise<{
    isHealthy: boolean;
    stats: any;
    message: string;
  }> {
    try {
      const stats = await contactEmbeddingService.getEmbeddingStats();
      const isHealthy = stats.percentage >= 90; // At least 90% of contacts have embeddings
      
      return {
        isHealthy,
        stats,
        message: isHealthy 
          ? `Embeddings healthy: ${stats.withEmbeddings}/${stats.total} contacts (${stats.percentage}%)`
          : `Embeddings incomplete: ${stats.withEmbeddings}/${stats.total} contacts (${stats.percentage}%) - need to generate more`
      };
    } catch (error) {
      return {
        isHealthy: false,
        stats: null,
        message: `Embedding health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}

// Export singleton instance
export const hybridContactSearchService = new HybridContactSearchService();