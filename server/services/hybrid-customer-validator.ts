import { db } from "../db";
import { customers } from "@shared/schema";
import { sql, eq, ilike, or } from "drizzle-orm";
import OpenAI from "openai";

// Lazy initialization of OpenAI client
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

interface CustomerValidatorInput {
  customerName?: string;
  customerEmail?: string;
  senderEmail?: string;
  senderDomain?: string;
  contactName?: string;
  phoneDigits?: string;
  address?: {
    city?: string;
    state?: string;
    zip?: string;
  };
  netsuiteId?: string;
  customerNumber?: string;
}

interface CustomerCandidate {
  id: string;
  customerNumber: string;
  companyName: string;
  email?: string;
  phone?: string;
  phoneDigits?: string;
  netsuiteId?: string;
  address?: any;
  cosineSim?: number;
  domainMatch?: boolean;
  finalScore?: number;
}

interface CustomerValidatorResult {
  matched: boolean;
  method: 'exact_match' | 'vector' | 'vector+llm' | 'none';
  customerNumber?: string;
  customerName?: string;
  confidence: number;
  reasons: string[];
  alternatives: Array<{
    customerNumber: string;
    score: number;
  }>;
  auditId?: string;
}

export class HybridCustomerValidator {
  
  /**
   * Step 0: Normalize inputs per email
   */
  private normalizeInput(input: CustomerValidatorInput): CustomerValidatorInput {
    const normalized: CustomerValidatorInput = {
      customerName: input.customerName?.toLowerCase().trim().replace(/\s+/g, ' '),
      customerEmail: input.customerEmail?.toLowerCase().trim(),
      senderEmail: input.senderEmail?.toLowerCase().trim(),
      senderDomain: input.senderDomain?.toLowerCase().trim() || 
                   input.senderEmail?.split('@')[1]?.toLowerCase().trim() ||
                   input.customerEmail?.split('@')[1]?.toLowerCase().trim(),
      contactName: input.contactName?.toLowerCase().trim().replace(/\s+/g, ' '),
      phoneDigits: input.phoneDigits?.replace(/\D/g, ''),
      netsuiteId: input.netsuiteId?.trim(),
      customerNumber: input.customerNumber?.trim(),
      address: input.address ? {
        city: input.address.city?.toLowerCase().trim(),
        state: input.address.state?.toLowerCase().trim(),
        zip: input.address.zip?.replace(/\D/g, '')
      } : undefined
    };

    // Extract phone digits from phone field if not provided
    if (!normalized.phoneDigits && input.phoneDigits) {
      normalized.phoneDigits = input.phoneDigits.replace(/\D/g, '');
    }

    return normalized;
  }

  /**
   * Step 1: Exact & deterministic SQL (short-circuit if single hit)
   */
  private async exactDeterministicSearch(input: CustomerValidatorInput): Promise<CustomerCandidate | CustomerCandidate[] | null> {
    console.log(`🎯 EXACT SEARCH: Starting deterministic lookup`);

    // Priority 1: By NetSuite ID / Customer Number
    if (input.netsuiteId || input.customerNumber) {
      const exactMatches = await db
        .select()
        .from(customers)
        .where(or(
          input.netsuiteId ? eq(customers.netsuiteId, input.netsuiteId) : undefined,
          input.customerNumber ? eq(customers.customerNumber, input.customerNumber) : undefined
        ))
        .limit(2);

      if (exactMatches.length === 1) {
        console.log(`   ✅ Single exact match by ID/Number: ${exactMatches[0].companyName}`);
        return this.mapToCandidate(exactMatches[0]);
      }
      if (exactMatches.length > 1) {
        console.log(`   🔍 Multiple ID matches (${exactMatches.length}), need disambiguation`);
        return exactMatches.map(this.mapToCandidate);
      }
    }

    // Priority 2: By Email (exact)
    if (input.customerEmail) {
      const emailMatches = await db
        .select()
        .from(customers)
        .where(sql`LOWER(email) = LOWER(${input.customerEmail})`)
        .limit(2);

      if (emailMatches.length === 1) {
        console.log(`   ✅ Single exact match by email: ${emailMatches[0].companyName}`);
        return this.mapToCandidate(emailMatches[0]);
      }
      if (emailMatches.length > 1) {
        console.log(`   🔍 Multiple email matches (${emailMatches.length}), need disambiguation`);
        return emailMatches.map(this.mapToCandidate);
      }
    }

    // Priority 3: By Domain with brand overrides
    if (input.senderDomain) {
      const domainMatches = await db
        .select()
        .from(customers)
        .where(sql`LOWER(SPLIT_PART(email,'@',2)) = LOWER(${input.senderDomain}) AND is_active = TRUE`)
        .limit(25);

      if (domainMatches.length === 1) {
        console.log(`   ✅ Single domain match: ${domainMatches[0].companyName}`);
        return this.mapToCandidate(domainMatches[0]);
      }
      if (domainMatches.length > 1) {
        console.log(`   🔍 Multiple domain matches (${domainMatches.length}), need disambiguation`);
        return domainMatches.map(this.mapToCandidate);
      }
    }

    // Priority 4: By Phone (exact digits)
    if (input.phoneDigits && input.phoneDigits.length >= 10) {
      const phoneMatches = await db
        .select()
        .from(customers)
        .where(eq(customers.phoneDigits, input.phoneDigits))
        .limit(2);

      if (phoneMatches.length === 1) {
        console.log(`   ✅ Single phone match: ${phoneMatches[0].companyName}`);
        return this.mapToCandidate(phoneMatches[0]);
      }
      if (phoneMatches.length > 1) {
        console.log(`   🔍 Multiple phone matches (${phoneMatches.length}), need disambiguation`);
        return phoneMatches.map(this.mapToCandidate);
      }
    }

    // Priority 5: By Company (strict)
    if (input.customerName) {
      const companyMatches = await db
        .select()
        .from(customers)
        .where(ilike(customers.companyName, input.customerName))
        .orderBy(sql`LENGTH(company_name) ASC`)
        .limit(10);

      if (companyMatches.length === 1) {
        console.log(`   ✅ Single company match: ${companyMatches[0].companyName}`);
        return this.mapToCandidate(companyMatches[0]);
      }
      if (companyMatches.length > 1) {
        console.log(`   🔍 Multiple company matches (${companyMatches.length}), need disambiguation`);
        return companyMatches.map(this.mapToCandidate);
      }
    }

    console.log(`   ❌ No exact matches found`);
    return null;
  }

  /**
   * Step 2: PGvector semantic candidate search (narrowed by filters)
   */
  private async semanticCandidateSearch(input: CustomerValidatorInput): Promise<CustomerCandidate[]> {
    console.log(`🔮 SEMANTIC SEARCH: Starting vector similarity search`);

    // Create query text for embedding
    const queryText = [
      input.customerName,
      input.senderDomain,
      input.contactName,
      input.address?.city && input.address?.state ? `${input.address.city} ${input.address.state}` : '',
      input.phoneDigits
    ].filter(Boolean).join(' | ');

    console.log(`   📝 Query text: "${queryText}"`);

    // Generate embedding
    const client = getOpenAIClient();
    const embeddingResponse = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: queryText
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Search with vector similarity and optional filters
    const vectorMatches = await db.execute(sql`
      WITH params AS (
        SELECT
          CAST(${JSON.stringify(queryEmbedding)}::text AS vector(1536)) AS q,
          ${input.senderDomain}::text AS domain_filter,
          ${input.customerName ? `%${input.customerName}%` : null}::text AS company_hint
      )
      SELECT
        c.id, c.customer_number, c.company_name, c.email, c.phone, c.phone_digits, c.netsuite_id,
        1 - (c.customer_embedding <=> p.q) AS cosine_sim,
        (LOWER(SPLIT_PART(c.email,'@',2)) = LOWER(p.domain_filter)) AS domain_match
      FROM customers c, params p
      WHERE c.customer_embedding IS NOT NULL
        AND (p.domain_filter IS NULL OR LOWER(SPLIT_PART(c.email,'@',2)) = LOWER(p.domain_filter))
        AND (p.company_hint IS NULL OR c.company_name ILIKE p.company_hint)
      ORDER BY c.customer_embedding <=> p.q
      LIMIT 25
    `);

    const candidates = vectorMatches.rows.map(row => ({
      id: row.id as string,
      customerNumber: row.customer_number as string,
      companyName: row.company_name as string,
      email: row.email as string,
      phone: row.phone as string,
      phoneDigits: row.phone_digits as string,
      netsuiteId: row.netsuite_id as string,
      cosineSim: parseFloat(row.cosine_sim as string),
      domainMatch: row.domain_match as boolean
    }));

    console.log(`   🎯 Found ${candidates.length} vector candidates`);
    return candidates;
  }

  /**
   * Step 3: Rule-aware re-rank (app side)
   */
  private reRankCandidates(candidates: CustomerCandidate[], input: CustomerValidatorInput): CustomerCandidate[] {
    console.log(`📊 RE-RANKING: Scoring ${candidates.length} candidates`);

    const rankedCandidates = candidates.map(candidate => {
      let finalScore = 0;

      // Base similarity (70%)
      finalScore += 0.70 * (candidate.cosineSim || 0);

      // Domain match bonus (15%)
      if (candidate.domainMatch) {
        finalScore += 0.15;
      }

      // Phone match bonus (5%)
      if (input.phoneDigits && candidate.phoneDigits && 
          input.phoneDigits === candidate.phoneDigits) {
        finalScore += 0.05;
      }

      // City/state match bonus (5%)
      if (input.address?.city && input.address?.state) {
        // This would need address parsing from candidate.address
        // For now, placeholder logic
        finalScore += 0.05 * 0.5; // Partial credit
      }

      // Alias/brand match bonus (5%)
      if (input.customerName && candidate.companyName) {
        const inputWords = input.customerName.split(' ');
        const candidateWords = candidate.companyName.toLowerCase().split(' ');
        const matchRatio = inputWords.filter(word => 
          candidateWords.some(cWord => cWord.includes(word))
        ).length / inputWords.length;
        finalScore += 0.05 * matchRatio;
      }

      return {
        ...candidate,
        finalScore
      };
    });

    // Sort by final score descending
    rankedCandidates.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

    rankedCandidates.forEach((candidate, index) => {
      console.log(`   ${index + 1}. ${candidate.companyName} (Score: ${candidate.finalScore?.toFixed(3)})`);
    });

    return rankedCandidates;
  }

  /**
   * Step 4: LLM tiebreak (only when needed)
   */
  private async llmTiebreak(candidates: CustomerCandidate[], input: CustomerValidatorInput): Promise<{
    selectedId: string | null;
    reason: string;
    llmResponse: any;
  }> {
    console.log(`🤖 LLM TIEBREAK: Resolving close matches`);

    const client = getOpenAIClient();
    
    const prompt = {
      query: {
        company_text: input.customerName,
        sender_email: input.senderEmail,
        sender_domain: input.senderDomain,
        contact_name: input.contactName,
        phone_digits: input.phoneDigits,
        city: input.address?.city,
        state: input.address?.state
      },
      candidates: candidates.slice(0, 3).map(c => ({
        id: c.customerNumber,
        company: c.companyName,
        email: c.email,
        domain: c.email?.split('@')[1],
        phone_digits: c.phoneDigits,
        final_score: c.finalScore
      }))
    };

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a deterministic resolver. Choose exactly one candidate_id or say \"NONE\". Base your choice ONLY on the provided fields; do not infer new facts. Respond with JSON format: {\"selected_id\":\"...\",\"reason\":\"...\"}"
        },
        {
          role: "user",
          content: JSON.stringify(prompt)
        }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    console.log(`   🎯 LLM selected: ${result.selected_id} - ${result.reason}`);

    return {
      selectedId: result.selected_id === "NONE" ? null : result.selected_id,
      reason: result.reason || "No reason provided",
      llmResponse: result
    };
  }

  /**
   * Step 5: Main validation orchestrator
   */
  async validateCustomer(input: CustomerValidatorInput): Promise<CustomerValidatorResult> {
    console.log(`🔍 HYBRID CUSTOMER VALIDATOR: Starting validation`);
    console.log(`   📋 Input:`, input);

    const startTime = Date.now();
    const normalizedInput = this.normalizeInput(input);
    console.log(`   🧹 Normalized:`, normalizedInput);

    let auditData: any = {
      query_data: normalizedInput,
      top_candidates: [],
      selected_customer_id: null,
      confidence_score: 0,
      method: 'none',
      reasons: [],
      llm_response: null
    };

    try {
      // Step 1: Exact & deterministic search
      const exactResult = await this.exactDeterministicSearch(normalizedInput);
      
      if (exactResult && !Array.isArray(exactResult)) {
        // Single confident match - short circuit
        console.log(`   ✅ EXACT MATCH: ${exactResult.companyName}`);
        
        const result: CustomerValidatorResult = {
          matched: true,
          method: 'exact_match',
          customerNumber: exactResult.customerNumber,
          customerName: exactResult.companyName,
          confidence: 1.0,
          reasons: ['exact_deterministic_match'],
          alternatives: []
        };

        // Log to audit
        auditData = {
          ...auditData,
          selected_customer_id: exactResult.customerNumber,
          confidence_score: 1.0,
          method: 'exact_match',
          reasons: ['exact_deterministic_match']
        };

        await this.logAudit(auditData);
        console.log(`   ⏱️ Completed in ${Date.now() - startTime}ms`);
        return result;
      }

      // Step 2: Get initial candidates (exact matches or semantic search)
      let candidates: CustomerCandidate[] = [];
      
      if (Array.isArray(exactResult)) {
        candidates = exactResult;
        console.log(`   📋 Using ${candidates.length} exact match candidates for disambiguation`);
      } else {
        // No exact matches, try semantic search
        candidates = await this.semanticCandidateSearch(normalizedInput);
      }

      if (candidates.length === 0) {
        console.log(`   ❌ NO MATCHES: No candidates found`);
        
        const result: CustomerValidatorResult = {
          matched: false,
          method: 'none',
          confidence: 0,
          reasons: ['no_candidates_found'],
          alternatives: []
        };

        auditData.method = 'none';
        auditData.reasons = ['no_candidates_found'];
        await this.logAudit(auditData);
        
        console.log(`   ⏱️ Completed in ${Date.now() - startTime}ms`);
        return result;
      }

      // Step 3: Rule-aware re-ranking
      const rankedCandidates = this.reRankCandidates(candidates, normalizedInput);
      auditData.top_candidates = rankedCandidates.slice(0, 5);

      const topCandidate = rankedCandidates[0];
      const secondCandidate = rankedCandidates[1];

      // Decision logic based on scores and margins
      const topScore = topCandidate.finalScore || 0;
      const margin = secondCandidate ? topScore - (secondCandidate.finalScore || 0) : 1.0;

      console.log(`   📊 Top score: ${topScore.toFixed(3)}, Margin: ${margin.toFixed(3)}`);

      // High confidence auto-accept
      if (topScore >= 0.85 && margin >= 0.03) {
        console.log(`   ✅ HIGH CONFIDENCE: Auto-accepting top candidate`);
        
        const result: CustomerValidatorResult = {
          matched: true,
          method: 'vector',
          customerNumber: topCandidate.customerNumber,
          customerName: topCandidate.companyName,
          confidence: topScore,
          reasons: this.buildReasons(topCandidate, normalizedInput),
          alternatives: rankedCandidates.slice(1, 3).map(c => ({
            customerNumber: c.customerNumber,
            score: c.finalScore || 0
          }))
        };

        auditData = {
          ...auditData,
          selected_customer_id: topCandidate.customerNumber,
          confidence_score: topScore,
          method: 'vector',
          reasons: result.reasons
        };

        await this.logAudit(auditData);
        console.log(`   ⏱️ Completed in ${Date.now() - startTime}ms`);
        return result;
      }

      // Borderline case - use LLM tiebreak
      if (topScore >= 0.75 && margin < 0.03 && rankedCandidates.length > 1) {
        console.log(`   🤖 BORDERLINE: Using LLM tiebreak`);
        
        const tiebreakResult = await this.llmTiebreak(rankedCandidates.slice(0, 3), normalizedInput);
        auditData.llm_response = tiebreakResult.llmResponse;

        if (tiebreakResult.selectedId) {
          const selectedCandidate = rankedCandidates.find(c => c.customerNumber === tiebreakResult.selectedId);
          
          if (selectedCandidate) {
            const result: CustomerValidatorResult = {
              matched: true,
              method: 'vector+llm',
              customerNumber: selectedCandidate.customerNumber,
              customerName: selectedCandidate.companyName,
              confidence: 0.8, // LLM-assisted confidence
              reasons: [...this.buildReasons(selectedCandidate, normalizedInput), `llm_tiebreak: ${tiebreakResult.reason}`],
              alternatives: rankedCandidates.filter(c => c.customerNumber !== tiebreakResult.selectedId).slice(0, 2).map(c => ({
                customerNumber: c.customerNumber,
                score: c.finalScore || 0
              }))
            };

            auditData = {
              ...auditData,
              selected_customer_id: selectedCandidate.customerNumber,
              confidence_score: 0.8,
              method: 'vector+llm',
              reasons: result.reasons
            };

            await this.logAudit(auditData);
            console.log(`   ⏱️ Completed in ${Date.now() - startTime}ms`);
            return result;
          }
        }
      }

      // Low confidence - no auto-match
      console.log(`   ⚠️ LOW CONFIDENCE: Scores too low for auto-match`);
      
      const result: CustomerValidatorResult = {
        matched: false,
        method: 'none',
        confidence: topScore,
        reasons: ['confidence_too_low', `top_score: ${topScore.toFixed(3)}`],
        alternatives: rankedCandidates.slice(0, 3).map(c => ({
          customerNumber: c.customerNumber,
          score: c.finalScore || 0
        }))
      };

      auditData = {
        ...auditData,
        confidence_score: topScore,
        method: 'none',
        reasons: result.reasons
      };

      await this.logAudit(auditData);
      console.log(`   ⏱️ Completed in ${Date.now() - startTime}ms`);
      return result;

    } catch (error) {
      console.error(`   ❌ ERROR: ${error}`);
      
      auditData.method = 'error';
      auditData.reasons = [`error: ${(error as Error).message || 'Unknown error'}`];
      await this.logAudit(auditData);

      return {
        matched: false,
        method: 'none',
        confidence: 0,
        reasons: [`error: ${(error as Error).message || 'Unknown error'}`],
        alternatives: []
      };
    }
  }

  private mapToCandidate(customer: any): CustomerCandidate {
    return {
      id: customer.id,
      customerNumber: customer.customerNumber || customer.customer_number,
      companyName: customer.companyName || customer.company_name,
      email: customer.email,
      phone: customer.phone,
      phoneDigits: customer.phoneDigits || customer.phone_digits,
      netsuiteId: customer.netsuiteId || customer.netsuite_id,
      address: customer.address
    };
  }

  private buildReasons(candidate: CustomerCandidate, input: CustomerValidatorInput): string[] {
    const reasons: string[] = [];
    
    if (candidate.domainMatch) reasons.push('domain_match');
    if (input.phoneDigits && candidate.phoneDigits === input.phoneDigits) reasons.push('phone_match');
    if (candidate.cosineSim && candidate.cosineSim > 0.8) reasons.push('high_semantic_similarity');
    if (candidate.finalScore && candidate.finalScore > 0.85) reasons.push('high_composite_score');
    
    return reasons;
  }

  private async logAudit(auditData: any): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO customer_resolution_audit 
        (query_data, top_candidates, selected_customer_id, confidence_score, method, reasons, llm_response)
        VALUES (${JSON.stringify(auditData.query_data)}, ${JSON.stringify(auditData.top_candidates)}, 
                ${auditData.selected_customer_id}, ${auditData.confidence_score}, ${auditData.method}, 
                ${auditData.reasons}, ${auditData.llm_response ? JSON.stringify(auditData.llm_response) : null})
      `);
    } catch (error) {
      console.error('Failed to log audit:', error);
    }
  }
}

// Export service instance
export const hybridCustomerValidator = new HybridCustomerValidator();