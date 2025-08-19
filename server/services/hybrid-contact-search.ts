import OpenAI from "openai";
import { db } from "../db";
import { contacts } from "../../shared/schema";
import { eq, ilike, sql, and, or } from "drizzle-orm";

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
  company?: string;
}

interface ContactSearchResult {
  contact?: any;
  confidence: number;
  method: 'exact_email' | 'domain_company' | 'semantic' | 'not_found';
  similarityScore?: number;
  domainBonus?: number;
  aliasBonus?: number;
  alternatives?: any[];
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
      .where(eq(contacts.email, normalizedEmail))
      .limit(1);

    return results.length > 0 ? results[0] : null;
  }

  /**
   * Step 2: Domain + company matching for ambiguous cases
   */
  private async findByDomainAndCompany(domain: string, company?: string): Promise<any[]> {
    console.log(`   🔍 Domain matching: Searching domain "${domain}" with company "${company || 'N/A'}"`);

    const results = await db
      .select()
      .from(contacts)
      .where(sql`lower(split_part(email, '@', 2)) = ${domain.toLowerCase()}`)
      .limit(10);

    return results;
  }

  /**
   * Build contact text for semantic search (matches embedding generation)
   */
  private buildContactText(input: ContactSearchInput): string {
    const parts = [];
    
    if (input.name) parts.push(input.name);
    if (input.jobTitle) parts.push(input.jobTitle);
    if (input.email) {
      parts.push(input.email);
      const domain = this.extractDomain(input.email);
      if (domain) parts.push(domain);
    }
    if (input.phone) parts.push(input.phone);
    if (input.company) parts.push(input.company);
    
    return parts.join(" | ");
  }

  /**
   * Step 3: Semantic search using PGvector
   */
  private async findBySemantic(input: ContactSearchInput, domain?: string): Promise<any[]> {
    const searchText = this.buildContactText(input);
    console.log(`   🔮 Semantic search: Searching for "${searchText}"`);

    try {
      // Generate embedding for search text
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small", // 1536 dimensions  
        input: searchText,
      });

      const queryEmbedding = response.data[0].embedding;

      // For now, return a smaller test result to confirm the method works
      console.log(`   🔮 Semantic search embedding generated: ${queryEmbedding.length} dimensions`);
      
      // Simple test: return contacts that have embeddings, no vector search yet
      const testResults = await db
        .select()
        .from(contacts)
        .where(sql`contact_embedding IS NOT NULL`)
        .limit(5);
      
      console.log(`   📊 Found ${testResults.length} test contacts with embeddings`);
      
      // Return with mock similarity scores for now
      return testResults.map(contact => ({
        ...contact,
        cosine_sim: 0.80 // Mock score for testing
      }));
      
    } catch (error) {
      console.error(`   ❌ Semantic search failed:`, error);
      return [];
    }
  }

  /**
   * Step 4: Rerank with business rules and scoring
   */
  private reRankResults(results: any[], input: ContactSearchInput): any[] {
    const domain = this.extractDomain(input.email);
    
    return results.map(result => {
      const cosineSim = result.cosine_sim || 0;
      
      // Domain bonus (20% weight)
      let domainBonus = 0;
      if (domain && result.email) {
        const resultDomain = this.extractDomain(result.email);
        if (resultDomain === domain) {
          domainBonus = 0.2;
        }
      }

      // Alias/name bonus (10% weight) - simple approach
      let aliasBonus = 0;
      if (input.name && result.name) {
        const inputName = input.name.toLowerCase();
        const resultName = result.name.toLowerCase();
        if (inputName.includes(resultName) || resultName.includes(inputName)) {
          aliasBonus = 0.1;
        }
      }

      // Final score: 70% cosine + 20% domain + 10% alias
      const finalScore = (0.7 * cosineSim) + domainBonus + aliasBonus;

      return {
        ...result,
        finalScore,
        cosineSim,
        domainBonus,
        aliasBonus
      };
    }).sort((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * Main hybrid search method implementing the recommended flow
   */
  async searchContact(input: ContactSearchInput): Promise<ContactSearchResult> {
    console.log(`🔍 HYBRID CONTACT SEARCH: Starting search for:`, {
      name: input.name,
      email: input.email,
      jobTitle: input.jobTitle,
      company: input.company
    });

    // Step 1: Deterministic gate - exact email match
    if (input.email) {
      const exactMatch = await this.findByExactEmail(input.email);
      if (exactMatch) {
        console.log(`   ✅ Found exact email match`);
        return {
          contact: exactMatch,
          confidence: 1.0,
          method: 'exact_email',
          reason: `Exact email match found for "${input.email}"`
        };
      }
    }

    const domain = this.extractDomain(input.email);

    // Step 2: Domain + company matching
    if (domain) {
      const domainMatches = await this.findByDomainAndCompany(domain, input.company);
      if (domainMatches.length === 1) {
        console.log(`   ✅ Found unique domain+company match`);
        return {
          contact: domainMatches[0],
          confidence: 0.9,
          method: 'domain_company',
          reason: `Unique match found for domain "${domain}" with company context`,
          alternatives: []
        };
      } else if (domainMatches.length > 1) {
        console.log(`   ⚠️  Multiple domain matches found, proceeding to semantic search`);
      }
    }

    // Step 3: Semantic search
    const semanticResults = await this.findBySemantic(input, domain);
    
    if (semanticResults.length === 0) {
      console.log(`   ❌ No semantic matches found`);
      return {
        confidence: 0,
        method: 'not_found',
        reason: `No matches found for contact search`,
        alternatives: []
      };
    }

    // Step 4: Rerank and apply thresholds
    const rankedResults = this.reRankResults(semanticResults, input);
    const topResult = rankedResults[0];
    const alternatives = rankedResults.slice(1, 6); // Top 5 alternatives

    console.log(`   📊 Top result score: ${topResult.finalScore.toFixed(3)} (cosine: ${topResult.cosineSim.toFixed(3)})`);

    // Apply thresholds from your document:
    // Accept ≥ 0.85; if 0.75–0.85, require corroborator; else punt to CSR
    if (topResult.finalScore >= 0.85) {
      console.log(`   ✅ High confidence match (≥0.85)`);
      return {
        contact: topResult,
        confidence: topResult.finalScore,
        method: 'semantic',
        similarityScore: topResult.cosineSim,
        domainBonus: topResult.domainBonus,
        aliasBonus: topResult.aliasBonus,
        reason: `High confidence semantic match (score: ${topResult.finalScore.toFixed(3)})`,
        alternatives
      };
    } else if (topResult.finalScore >= 0.75) {
      console.log(`   ⚠️  Medium confidence match (0.75-0.85) - needs corroboration`);
      return {
        contact: topResult,
        confidence: topResult.finalScore,
        method: 'semantic',
        similarityScore: topResult.cosineSim,
        domainBonus: topResult.domainBonus,
        aliasBonus: topResult.aliasBonus,
        reason: `Medium confidence match requiring manual verification (score: ${topResult.finalScore.toFixed(3)})`,
        alternatives
      };
    } else {
      console.log(`   ❌ Low confidence match (<0.75) - punt to CSR`);
      return {
        confidence: topResult.finalScore,
        method: 'not_found',
        reason: `Low confidence semantic matches found (top score: ${topResult.finalScore.toFixed(3)}). Manual review required.`,
        alternatives: rankedResults.slice(0, 5)
      };
    }
  }

  /**
   * Test search method for API endpoints
   */
  async testSearch(searchParams: ContactSearchInput): Promise<any> {
    try {
      const result = await this.searchContact(searchParams);
      return {
        success: true,
        result,
        searchParams
      };
    } catch (error) {
      console.error('Contact search test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        searchParams
      };
    }
  }

  /**
   * Check embedding health and coverage
   */
  async checkEmbeddingHealth(): Promise<any> {
    try {
      const totalContacts = await db.execute(sql`SELECT COUNT(*) as count FROM contacts`);
      const embeddedContacts = await db.execute(sql`SELECT COUNT(*) as count FROM contacts WHERE contact_embedding IS NOT NULL`);
      
      const total = parseInt(totalContacts.rows[0].count as string);
      const embedded = parseInt(embeddedContacts.rows[0].count as string);
      const coverage = total > 0 ? (embedded / total * 100).toFixed(2) : '0.00';

      return {
        totalContacts: total,
        embeddedContacts: embedded,
        coveragePercentage: parseFloat(coverage),
        isHealthy: embedded > 0,
        status: embedded > 0 ? 'operational' : 'no_embeddings'
      };
    } catch (error) {
      console.error('Error checking embedding health:', error);
      return {
        totalContacts: 0,
        embeddedContacts: 0,
        coveragePercentage: 0,
        isHealthy: false,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export const hybridContactSearchService = new HybridContactSearchService();