import { db } from "../db";
import { contacts } from "@shared/schema";
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

interface ContactValidatorInput {
  extractedData?: any;
  senderName?: string;
  senderEmail?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  jobTitle?: string;
  company?: string;
  customerNumber?: string;
  netsuiteInternalId?: string;
}

interface ContactCandidate {
  id: string;
  netsuiteInternalId: string;
  name: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  inactive: boolean;
  cosineSim?: number;
  emailMatch?: boolean;
  domainMatch?: boolean;
  nameMatch?: boolean;
  finalScore?: number;
}

interface ContactValidatorResult {
  name: string;
  email: string;
  phone: string;
  role: 'Purchasing' | 'Accounts Payable' | 'Sales' | 'Owner' | 'CSR' | 'Unknown';
  matched_contact_id: string;
  match_method: 'exact_email' | 'exact_name' | 'vector' | 'vector+llm' | 'extracted_json' | 'unknown';
  confidence: number;
  evidence: string[];
  alternatives?: Array<{
    name: string;
    email: string;
    score: number;
  }>;
  auditId?: string;
}

export class HybridContactValidator {
  
  /**
   * Step 0: Normalize inputs per email
   */
  private normalizeInput(input: ContactValidatorInput): ContactValidatorInput {
    const normalized: ContactValidatorInput = {
      extractedData: input.extractedData,
      senderName: input.senderName?.toLowerCase().trim().replace(/\s+/g, ' '),
      senderEmail: input.senderEmail?.toLowerCase().trim(),
      contactName: input.contactName?.toLowerCase().trim().replace(/\s+/g, ' '),
      contactEmail: input.contactEmail?.toLowerCase().trim(),
      contactPhone: input.contactPhone?.replace(/\D/g, ''),
      jobTitle: input.jobTitle?.toLowerCase().trim(),
      company: input.company?.toLowerCase().trim(),
      customerNumber: input.customerNumber?.trim(),
      netsuiteInternalId: input.netsuiteInternalId?.trim()
    };

    // Extract contact info from extractedData if available
    if (input.extractedData?.contact) {
      normalized.contactName = normalized.contactName || input.extractedData.contact.name?.toLowerCase().trim();
      normalized.contactEmail = normalized.contactEmail || input.extractedData.contact.email?.toLowerCase().trim();
      normalized.contactPhone = normalized.contactPhone || input.extractedData.contact.phone?.replace(/\D/g, '');
      normalized.jobTitle = normalized.jobTitle || input.extractedData.contact.jobTitle?.toLowerCase().trim();
    }

    // SECURITY FILTER: Never use @highcaliberline.com emails as contacts for forwarded emails
    // These are forwarder emails, not actual customer contacts
    if (normalized.senderEmail?.includes('@highcaliberline.com')) {
      console.log(`   🚫 SECURITY FILTER: Filtering out @highcaliberline.com forwarder email: ${normalized.senderEmail}`);
      
      // For forwarded emails, prioritize the original sender from extractedData
      if (input.extractedData?.forwardedEmail?.originalSender) {
        const originalSenderEmail = input.extractedData.forwardedEmail.originalSender.toLowerCase().trim();
        const emailMatch = originalSenderEmail.match(/<(.+?)>$/);
        const cleanEmail = emailMatch ? emailMatch[1] : originalSenderEmail;
        
        console.log(`   ✅ Using original sender instead: ${cleanEmail}`);
        normalized.senderEmail = cleanEmail;
        
        // Also extract name from original sender if available
        const nameMatch = originalSenderEmail.match(/^(.+?)\s*</);
        if (nameMatch) {
          normalized.senderName = nameMatch[1].trim().toLowerCase().replace(/\s+/g, ' ');
        }
      } else {
        // If no original sender available, use extracted contact data only
        console.log(`   ⚠️  No original sender available - using extracted contact data only`);
      }
    }

    // Filter out @highcaliberline.com from contact email as well
    if (normalized.contactEmail?.includes('@highcaliberline.com')) {
      console.log(`   🚫 SECURITY FILTER: Filtering out @highcaliberline.com from contact email`);
      normalized.contactEmail = undefined; // Clear the HCL email so we use sender fallback
    }

    // Use sender info as fallback (after security filtering)
    normalized.contactName = normalized.contactName || normalized.senderName;
    normalized.contactEmail = normalized.contactEmail || normalized.senderEmail;

    return normalized;
  }

  /**
   * Step 1: Exact & deterministic SQL (short-circuit if single hit)
   */
  private async exactDeterministicSearch(input: ContactValidatorInput): Promise<ContactCandidate | ContactCandidate[] | null> {
    console.log(`🎯 EXACT CONTACT SEARCH: Starting deterministic lookup`);

    // Priority 1: By NetSuite Internal ID
    if (input.netsuiteInternalId) {
      const exactMatches = await db
        .select()
        .from(contacts)
        .where(eq(contacts.netsuiteInternalId, input.netsuiteInternalId))
        .limit(2);

      if (exactMatches.length === 1) {
        console.log(`   ✅ Single exact match by NetSuite ID: ${exactMatches[0].name}`);
        return this.mapToCandidate(exactMatches[0]);
      }
      if (exactMatches.length > 1) {
        console.log(`   🔍 Multiple NetSuite ID matches (${exactMatches.length}), need disambiguation`);
        return exactMatches.map(this.mapToCandidate);
      }
    }

    // Priority 2: By Email (exact)
    if (input.contactEmail) {
      const emailMatches = await db
        .select()
        .from(contacts)
        .where(sql`LOWER(email) = LOWER(${input.contactEmail}) AND inactive = FALSE`)
        .limit(2);

      if (emailMatches.length === 1) {
        console.log(`   ✅ Single exact match by email: ${emailMatches[0].name}`);
        return this.mapToCandidate(emailMatches[0]);
      }
      if (emailMatches.length > 1) {
        console.log(`   🔍 Multiple email matches (${emailMatches.length}), need disambiguation`);
        return emailMatches.map(this.mapToCandidate);
      }
    }

    // Priority 3: By Domain (for company association)
    if (input.contactEmail) {
      const domain = input.contactEmail.split('@')[1];
      if (domain) {
        const domainMatches = await db
          .select()
          .from(contacts)
          .where(sql`LOWER(SPLIT_PART(email,'@',2)) = LOWER(${domain}) AND inactive = FALSE`)
          .limit(10);

        if (domainMatches.length === 1) {
          console.log(`   ✅ Single domain match: ${domainMatches[0].name}`);
          return this.mapToCandidate(domainMatches[0]);
        }
        if (domainMatches.length > 1) {
          console.log(`   🔍 Multiple domain matches (${domainMatches.length}), need disambiguation`);
          return domainMatches.map(this.mapToCandidate);
        }
      }
    }

    // Priority 4: By Name (exact)
    if (input.contactName) {
      const nameMatches = await db
        .select()
        .from(contacts)
        .where(sql`LOWER(name) = LOWER(${input.contactName}) AND inactive = FALSE`)
        .limit(5);

      if (nameMatches.length === 1) {
        console.log(`   ✅ Single name match: ${nameMatches[0].name}`);
        return this.mapToCandidate(nameMatches[0]);
      }
      if (nameMatches.length > 1) {
        console.log(`   🔍 Multiple name matches (${nameMatches.length}), need disambiguation`);
        return nameMatches.map(this.mapToCandidate);
      }
    }

    console.log(`   ❌ No exact matches found`);
    return null;
  }

  /**
   * Step 2: PGvector semantic candidate search (narrowed by filters)
   */
  private async semanticCandidateSearch(input: ContactValidatorInput): Promise<ContactCandidate[]> {
    console.log(`🔮 SEMANTIC CONTACT SEARCH: Starting vector similarity search`);

    // Create query text for embedding
    const queryText = [
      input.contactName,
      input.contactEmail,
      input.jobTitle,
      input.company,
      input.contactPhone
    ].filter(Boolean).join(' | ');

    console.log(`   📝 Query text: "${queryText}"`);

    // Generate embedding
    const client = getOpenAIClient();
    const embeddingResponse = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: queryText
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Search with vector similarity and filters
    const vectorMatches = await db.execute(sql`
      WITH params AS (
        SELECT
          CAST(${JSON.stringify(queryEmbedding)}::text AS vector(1536)) AS q,
          ${input.contactEmail?.split('@')[1] || null}::text AS domain_filter,
          ${input.contactName ? `%${input.contactName}%` : null}::text AS name_hint
      )
      SELECT
        c.id, c.netsuite_internal_id, c.name, c.email, c.phone, c.job_title, c.inactive,
        1 - (c.contact_embedding <=> p.q) AS cosine_sim,
        (LOWER(c.email) = LOWER(${input.contactEmail || ''})) AS email_match,
        (LOWER(SPLIT_PART(c.email,'@',2)) = LOWER(p.domain_filter)) AS domain_match,
        (LOWER(c.name) ILIKE LOWER(p.name_hint)) AS name_match
      FROM contacts c, params p
      WHERE c.contact_embedding IS NOT NULL
        AND c.inactive = FALSE
        AND (p.domain_filter IS NULL OR LOWER(SPLIT_PART(c.email,'@',2)) = LOWER(p.domain_filter))
        AND (p.name_hint IS NULL OR c.name ILIKE p.name_hint)
      ORDER BY c.contact_embedding <=> p.q
      LIMIT 25
    `);

    const candidates = vectorMatches.rows.map(row => ({
      id: row.id as string,
      netsuiteInternalId: row.netsuite_internal_id as string,
      name: row.name as string,
      email: row.email as string,
      phone: row.phone as string,
      jobTitle: row.job_title as string,
      inactive: row.inactive as boolean,
      cosineSim: parseFloat(row.cosine_sim as string),
      emailMatch: row.email_match as boolean,
      domainMatch: row.domain_match as boolean,
      nameMatch: row.name_match as boolean
    }));

    console.log(`   🎯 Found ${candidates.length} vector candidates`);
    return candidates;
  }

  /**
   * Step 3: Rule-aware re-rank (app side)
   */
  private reRankCandidates(candidates: ContactCandidate[], input: ContactValidatorInput): ContactCandidate[] {
    console.log(`📊 RE-RANKING CONTACTS: Scoring ${candidates.length} candidates`);

    const rankedCandidates = candidates.map(candidate => {
      let finalScore = 0;

      // Base similarity (60%)
      finalScore += 0.60 * (candidate.cosineSim || 0);

      // Email exact match bonus (25%)
      if (candidate.emailMatch) {
        finalScore += 0.25;
      }

      // Domain match bonus (10%)
      if (candidate.domainMatch && !candidate.emailMatch) {
        finalScore += 0.10;
      }

      // Name match bonus (5%)
      if (candidate.nameMatch) {
        finalScore += 0.05;
      }

      return {
        ...candidate,
        finalScore
      };
    });

    // Sort by final score descending
    rankedCandidates.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

    rankedCandidates.forEach((candidate, index) => {
      console.log(`   ${index + 1}. ${candidate.name} <${candidate.email}> (Score: ${candidate.finalScore?.toFixed(3)})`);
    });

    return rankedCandidates;
  }

  /**
   * Step 4: LLM tiebreak (only when needed)
   */
  private async llmTiebreak(candidates: ContactCandidate[], input: ContactValidatorInput): Promise<{
    selectedId: string | null;
    reason: string;
    llmResponse: any;
  }> {
    console.log(`🤖 LLM CONTACT TIEBREAK: Resolving close matches`);

    const client = getOpenAIClient();
    
    const prompt = {
      query: {
        contact_name: input.contactName,
        contact_email: input.contactEmail,
        sender_name: input.senderName,
        sender_email: input.senderEmail,
        job_title: input.jobTitle,
        company: input.company
      },
      candidates: candidates.slice(0, 3).map(c => ({
        id: c.netsuiteInternalId,
        name: c.name,
        email: c.email,
        job_title: c.jobTitle,
        final_score: c.finalScore
      }))
    };

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a contact resolution assistant. Choose exactly one candidate_id or say \"NONE\". Base your choice on email, name, and company context. Respond with JSON: {\"selected_id\":\"...\",\"reason\":\"...\"}"
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
  async validateContact(input: ContactValidatorInput): Promise<ContactValidatorResult> {
    console.log(`🔍 HYBRID CONTACT VALIDATOR: Starting validation`);
    console.log(`   📋 Input:`, input);

    const startTime = Date.now();
    const normalizedInput = this.normalizeInput(input);
    console.log(`   🧹 Normalized:`, normalizedInput);

    let auditData: any = {
      query_data: normalizedInput,
      top_candidates: [],
      selected_contact_id: null,
      confidence_score: 0,
      method: 'unknown',
      reasons: [],
      llm_response: null
    };

    try {
      // Step 1: Exact & deterministic search
      const exactResult = await this.exactDeterministicSearch(normalizedInput);
      
      if (exactResult && !Array.isArray(exactResult)) {
        // Single confident match - short circuit
        console.log(`   ✅ EXACT CONTACT MATCH: ${exactResult.name}`);
        
        const result: ContactValidatorResult = {
          name: exactResult.name,
          email: exactResult.email || normalizedInput.contactEmail || normalizedInput.senderEmail || '',
          phone: exactResult.phone || '',
          role: this.inferRole(exactResult.jobTitle),
          matched_contact_id: exactResult.netsuiteInternalId,
          match_method: 'exact_email',
          confidence: 1.0,
          evidence: ['exact_deterministic_match'],
          alternatives: []
        };

        // Mark contact as verified since we have a database match
        await this.markContactAsVerified(result.matched_contact_id, result.match_method, result.confidence);

        console.log(`   ⏱️ Completed in ${Date.now() - startTime}ms`);
        return result;
      }

      // Step 2: Get initial candidates (exact matches or semantic search)
      let candidates: ContactCandidate[] = [];
      
      if (Array.isArray(exactResult)) {
        candidates = exactResult;
        console.log(`   📋 Using ${candidates.length} exact match candidates for disambiguation`);
      } else {
        // No exact matches, try semantic search
        candidates = await this.semanticCandidateSearch(normalizedInput);
      }

      if (candidates.length === 0) {
        // Return extracted data as fallback
        console.log(`   ❌ NO MATCHES: Using extracted data`);
        
        return {
          name: normalizedInput.contactName || normalizedInput.senderName || 'Unknown',
          email: normalizedInput.contactEmail || normalizedInput.senderEmail || '',
          phone: normalizedInput.contactPhone || '',
          role: 'Unknown',
          matched_contact_id: '',
          match_method: 'extracted_json' as const,
          confidence: 0.5,
          evidence: ['extracted_json_fallback'],
          alternatives: []
        };
      }

      // Step 3: Rule-aware re-ranking
      const rankedCandidates = this.reRankCandidates(candidates, normalizedInput);

      const topCandidate = rankedCandidates[0];
      const secondCandidate = rankedCandidates[1];

      // Decision logic based on scores and margins
      const topScore = topCandidate.finalScore || 0;
      const margin = secondCandidate ? topScore - (secondCandidate.finalScore || 0) : 1.0;

      console.log(`   📊 Top score: ${topScore.toFixed(3)}, Margin: ${margin.toFixed(3)}`);

      // High confidence auto-accept
      if (topScore >= 0.85 && margin >= 0.03) {
        console.log(`   ✅ HIGH CONFIDENCE: Auto-accepting top candidate`);
        
        const result = {
          name: topCandidate.name,
          email: topCandidate.email || normalizedInput.contactEmail || normalizedInput.senderEmail || '',
          phone: topCandidate.phone || '',
          role: this.inferRole(topCandidate.jobTitle),
          matched_contact_id: topCandidate.netsuiteInternalId,
          match_method: 'vector' as const,
          confidence: topScore,
          evidence: this.buildEvidence(topCandidate, normalizedInput),
          alternatives: rankedCandidates.slice(1, 3).map(c => ({
            name: c.name,
            email: c.email || '',
            score: c.finalScore || 0
          }))
        };

        // Mark contact as verified since we have a database match
        await this.markContactAsVerified(result.matched_contact_id, result.match_method, result.confidence);
        
        return result;
      }

      // Borderline case - use LLM tiebreak
      if (topScore >= 0.75 && margin < 0.03 && rankedCandidates.length > 1) {
        console.log(`   🤖 BORDERLINE: Using LLM tiebreak`);
        
        const tiebreakResult = await this.llmTiebreak(rankedCandidates.slice(0, 3), normalizedInput);

        if (tiebreakResult.selectedId) {
          const selectedCandidate = rankedCandidates.find(c => c.netsuiteInternalId === tiebreakResult.selectedId);
          
          if (selectedCandidate) {
            const result = {
              name: selectedCandidate.name,
              email: selectedCandidate.email || normalizedInput.contactEmail || normalizedInput.senderEmail || '',
              phone: selectedCandidate.phone || '',
              role: this.inferRole(selectedCandidate.jobTitle),
              matched_contact_id: selectedCandidate.netsuiteInternalId,
              match_method: 'vector+llm' as const,
              confidence: 0.8,
              evidence: [...this.buildEvidence(selectedCandidate, normalizedInput), `llm_tiebreak: ${tiebreakResult.reason}`],
              alternatives: rankedCandidates.filter(c => c.netsuiteInternalId !== tiebreakResult.selectedId).slice(0, 2).map(c => ({
                name: c.name,
                email: c.email || '',
                score: c.finalScore || 0
              }))
            };

            // Mark contact as verified since we have a database match
            await this.markContactAsVerified(result.matched_contact_id, result.match_method, result.confidence);
            
            return result;
          }
        }
      }

      // Use top candidate with lower confidence
      console.log(`   ⚠️ LOWER CONFIDENCE: Using top candidate with reduced confidence`);
      
      const result = {
        name: topCandidate.name,
        email: topCandidate.email || normalizedInput.contactEmail || normalizedInput.senderEmail || '',
        phone: topCandidate.phone || '',
        role: this.inferRole(topCandidate.jobTitle),
        matched_contact_id: topCandidate.netsuiteInternalId,
        match_method: 'vector' as const,
        confidence: Math.max(topScore, 0.3), // Minimum confidence
        evidence: [...this.buildEvidence(topCandidate, normalizedInput), 'low_confidence_match'],
        alternatives: rankedCandidates.slice(1, 3).map(c => ({
          name: c.name,
          email: c.email || '',
          score: c.finalScore || 0
        }))
      };

      // Mark contact as verified since we have a database match (but may not meet threshold)
      await this.markContactAsVerified(result.matched_contact_id, result.match_method, result.confidence);
      
      return result;

    } catch (error) {
      console.error(`   ❌ ERROR: ${error}`);
      
      // Return extracted data as error fallback
      return {
        name: normalizedInput.contactName || normalizedInput.senderName || 'Unknown',
        email: normalizedInput.contactEmail || normalizedInput.senderEmail || '',
        phone: normalizedInput.contactPhone || '',
        role: 'Unknown',
        matched_contact_id: '',
        match_method: 'extracted_json' as const,
        confidence: 0.3,
        evidence: [`error_fallback: ${(error as Error).message || 'Unknown error'}`],
        alternatives: []
      };
    }
  }

  private mapToCandidate(contact: any): ContactCandidate {
    return {
      id: contact.id,
      netsuiteInternalId: contact.netsuiteInternalId || contact.netsuite_internal_id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      jobTitle: contact.jobTitle || contact.job_title,
      inactive: contact.inactive || false
    };
  }

  private buildEvidence(candidate: ContactCandidate, input: ContactValidatorInput): string[] {
    const evidence: string[] = [];
    
    if (candidate.emailMatch) evidence.push('exact_email_match');
    if (candidate.domainMatch) evidence.push('domain_match');
    if (candidate.nameMatch) evidence.push('name_match');
    if (candidate.cosineSim && candidate.cosineSim > 0.8) evidence.push('high_semantic_similarity');
    if (candidate.finalScore && candidate.finalScore > 0.85) evidence.push('high_composite_score');
    
    return evidence;
  }

  private inferRole(jobTitle?: string): 'Purchasing' | 'Accounts Payable' | 'Sales' | 'Owner' | 'CSR' | 'Unknown' {
    if (!jobTitle) return 'Unknown';
    
    const title = jobTitle.toLowerCase();
    
    if (title.includes('purchas') || title.includes('procurement') || title.includes('buyer')) return 'Purchasing';
    if (title.includes('account') || title.includes('payable') || title.includes('ap ')) return 'Accounts Payable';
    if (title.includes('sales') || title.includes('account manager') || title.includes('rep')) return 'Sales';
    if (title.includes('owner') || title.includes('president') || title.includes('ceo') || title.includes('founder')) return 'Owner';
    if (title.includes('csr') || title.includes('customer service') || title.includes('support')) return 'CSR';
    
    return 'Unknown';
  }

  /**
   * Mark contact as verified when database match is confirmed
   * Only updates verification fields if contact has matched_contact_id
   */
  private async markContactAsVerified(
    matched_contact_id: string, 
    match_method: string, 
    confidence: number
  ): Promise<void> {
    if (!matched_contact_id) {
      console.log(`   ⏸️ VERIFICATION: No database match - skipping verification update`);
      return;
    }

    try {
      // Only mark as verified if confidence meets threshold (>=0.7)
      const shouldVerify = confidence >= 0.7;
      
      if (shouldVerify) {
        await db
          .update(contacts)
          .set({
            verified: true,
            lastVerifiedAt: new Date(),
            lastVerifiedMethod: match_method,
            verificationConfidence: confidence,
            updatedAt: new Date()
          })
          .where(eq(contacts.netsuiteInternalId, matched_contact_id));

        console.log(`   ✅ VERIFICATION: Contact ${matched_contact_id} marked as verified (${Math.round(confidence * 100)}% confidence, method: ${match_method})`);
      } else {
        console.log(`   ⚠️ VERIFICATION: Contact ${matched_contact_id} confidence too low for verification (${Math.round(confidence * 100)}%)`);
      }
    } catch (error) {
      console.error(`   ❌ VERIFICATION ERROR: Failed to update verification status for contact ${matched_contact_id}:`, error);
    }
  }
}

// Export service instance
export const hybridContactValidator = new HybridContactValidator();