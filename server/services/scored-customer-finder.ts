import { storage } from '../storage';

interface CustomerCandidate {
  customerNumber: string;
  companyName: string;
  email?: string;
  domain?: string;
  asiNumber?: string;
  ppaiNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface ScoredCandidate {
  candidate: CustomerCandidate;
  score: number;
  rationale: string[];
  matchType: 'exact_customer_number' | 'exact_email' | 'exact_domain' | 'asi_ppai' | 'company_name' | 'root_brand' | 'address_overlap';
}

interface CustomerFinderInput {
  customerName?: string;
  customerEmail?: string;
  senderEmail?: string;
  asiNumber?: string;
  ppaiNumber?: string;
  address?: string;
}

interface CustomerFinderResult {
  status: 'found' | 'ambiguous' | 'not_found';
  customer_number?: string;
  customer_name?: string;
  confidence?: number;
  candidates?: ScoredCandidate[];
}

export class ScoredCustomerFinderService {
  
  // Brand override rules (exact matches)
  private brandOverrides: { [key: string]: { customer_number: string; customer_name: string } } = {
    'adventures in advertising': { customer_number: 'C12808', customer_name: 'Adventures In Advertising' },
    'aia': { customer_number: 'C12808', customer_name: 'Adventures In Advertising' },
    'kmoa': { customer_number: 'C12808', customer_name: 'Adventures In Advertising' },
    'mypromooffice': { customer_number: 'C12808', customer_name: 'Adventures In Advertising' },
    'staples': { customer_number: 'C1967', customer_name: 'Staples' },
    'staples canada': { customer_number: 'C136577', customer_name: 'Staples / Canada' },
    'quality logo products': { customer_number: 'C7657', customer_name: 'Quality Logo Products' },
    'qualitylogoproducts': { customer_number: 'C7657', customer_name: 'Quality Logo Products' },
    'halo': { customer_number: 'C2259', customer_name: 'Halo Branded Solutions' },
    'halo branded solutions': { customer_number: 'C2259', customer_name: 'Halo Branded Solutions' },
    'ipromoteu': { customer_number: 'C5286', customer_name: 'iPromoteu.com' },
    '4allpromos': { customer_number: 'C4211', customer_name: '4 All Promos LLC' },
    '4 all promos': { customer_number: 'C4211', customer_name: '4 All Promos LLC' }
  };

  async findCustomer(input: CustomerFinderInput): Promise<CustomerFinderResult> {
    console.log(`🎯 SCORED CUSTOMER FINDER: Starting tools-first lookup`);
    console.log(`   Input:`, JSON.stringify(input, null, 2));

    // Step 1: Check brand overrides first
    const brandOverride = this.checkBrandOverrides(input);
    if (brandOverride) {
      console.log(`   🎯 Brand override applied: ${brandOverride.customer_name} (${brandOverride.customer_number})`);
      return {
        status: 'found',
        customer_number: brandOverride.customer_number,
        customer_name: brandOverride.customer_name,
        confidence: 1.0
      };
    }

    // Step 2: Deterministic database scoring
    const scoredCandidates = await this.scoreCustomerCandidates(input);
    console.log(`   📊 Found ${scoredCandidates.length} scored candidates`);

    if (scoredCandidates.length === 0) {
      console.log(`   ❌ No candidates found in database`);
      return { status: 'not_found' };
    }

    // Step 3: Apply threshold logic
    const topCandidate = scoredCandidates[0];
    const secondCandidate = scoredCandidates[1];

    // High confidence: score ≥ 0.92 and margin ≥ 0.08
    const hasHighConfidence = topCandidate.score >= 0.92;
    const hasGoodMargin = !secondCandidate || (topCandidate.score - secondCandidate.score) >= 0.08;

    if (hasHighConfidence && hasGoodMargin) {
      console.log(`   ✅ High confidence match: ${topCandidate.candidate.companyName} (${topCandidate.candidate.customerNumber})`);
      console.log(`   📊 Score: ${topCandidate.score}, Rationale: ${topCandidate.rationale.join(', ')}`);
      return {
        status: 'found',
        customer_number: topCandidate.candidate.customerNumber,
        customer_name: topCandidate.candidate.companyName,
        confidence: topCandidate.score
      };
    }

    // Step 4: Ambiguous - use constrained LLM
    console.log(`   🤔 Ambiguous results - using constrained LLM to decide`);
    const llmResult = await this.useConstrainedLLM(input, scoredCandidates.slice(0, 5));
    
    return llmResult;
  }

  private checkBrandOverrides(input: CustomerFinderInput): { customer_number: string; customer_name: string } | null {
    const checks = [
      input.customerName?.toLowerCase().trim(),
      input.customerEmail?.split('@')[1]?.toLowerCase(),
      input.senderEmail?.split('@')[1]?.toLowerCase()
    ].filter(Boolean);

    for (const check of checks) {
      if (check && this.brandOverrides[check]) {
        return this.brandOverrides[check];
      }
    }
    return null;
  }

  private async scoreCustomerCandidates(input: CustomerFinderInput): Promise<ScoredCandidate[]> {
    const allCandidates: ScoredCandidate[] = [];

    // Strategy 1: Exact customer number lookup (if provided)
    if (input.customerEmail?.match(/C\d+/)) {
      const customerNumber = input.customerEmail.match(/C\d+/)?.[0];
      if (customerNumber) {
        const candidates = await this.searchByCustomerNumber(customerNumber);
        allCandidates.push(...candidates.map(c => ({
          candidate: c,
          score: 0.98,
          rationale: ['Exact customer number match'],
          matchType: 'exact_customer_number' as const
        })));
      }
    }

    // Strategy 2: Exact email match
    if (input.customerEmail) {
      const candidates = await this.searchByEmail(input.customerEmail);
      allCandidates.push(...candidates.map(c => ({
        candidate: c,
        score: 0.95,
        rationale: ['Exact email match'],
        matchType: 'exact_email' as const
      })));
    }

    if (input.senderEmail) {
      const candidates = await this.searchByEmail(input.senderEmail);
      allCandidates.push(...candidates.map(c => ({
        candidate: c,
        score: 0.93,
        rationale: ['Exact sender email match'],
        matchType: 'exact_email' as const
      })));
    }

    // Strategy 3: Email domain match
    const domains = [
      input.customerEmail?.split('@')[1],
      input.senderEmail?.split('@')[1]
    ].filter(Boolean);

    for (const domain of domains) {
      const candidates = await this.searchByDomain(domain!);
      allCandidates.push(...candidates.map(c => ({
        candidate: c,
        score: 0.85,
        rationale: [`Email domain match: ${domain}`],
        matchType: 'exact_domain' as const
      })));
    }

    // Strategy 4: ASI/PPAI exact match
    if (input.asiNumber) {
      const candidates = await this.searchByASI(input.asiNumber);
      allCandidates.push(...candidates.map(c => ({
        candidate: c,
        score: 0.90,
        rationale: [`ASI number match: ${input.asiNumber}`],
        matchType: 'asi_ppai' as const
      })));
    }

    if (input.ppaiNumber) {
      const candidates = await this.searchByPPAI(input.ppaiNumber);
      allCandidates.push(...candidates.map(c => ({
        candidate: c,
        score: 0.90,
        rationale: [`PPAI number match: ${input.ppaiNumber}`],
        matchType: 'asi_ppai' as const
      })));
    }

    // Strategy 5: Company name match (case-insensitive)
    if (input.customerName) {
      const candidates = await this.searchByCompanyName(input.customerName);
      allCandidates.push(...candidates.map(c => ({
        candidate: c,
        score: 0.75,
        rationale: [`Company name match: ${input.customerName}`],
        matchType: 'company_name' as const
      })));
    }

    // Strategy 6: Root brand matching (strip corporate suffixes)
    if (input.customerName) {
      const rootBrand = this.extractRootBrand(input.customerName);
      const candidates = await this.searchByRootBrand(rootBrand);
      allCandidates.push(...candidates.map(c => ({
        candidate: c,
        score: 0.65,
        rationale: [`Root brand match: ${rootBrand}`],
        matchType: 'root_brand' as const
      })));
    }

    // Remove duplicates and sort by score
    const uniqueCandidates = this.deduplicateAndSort(allCandidates);
    
    return uniqueCandidates.slice(0, 25); // Return top 25
  }

  private extractRootBrand(companyName: string): string {
    return companyName
      .toLowerCase()
      .trim()
      .replace(/\s*&\s*/g, ' and ')
      .replace(/\s*(inc|llc|ltd|co|corp|company|corporation)\s*$/i, '')
      .replace(/\s*(promotional|promo|products|marketing|printing|group|agency|solutions|services)\s*/gi, ' ')
      .split(/[,\-\/\|]/)[0]
      .trim();
  }

  private deduplicateAndSort(candidates: ScoredCandidate[]): ScoredCandidate[] {
    const seen = new Set<string>();
    const unique: ScoredCandidate[] = [];

    for (const candidate of candidates) {
      if (!seen.has(candidate.candidate.customerNumber)) {
        seen.add(candidate.candidate.customerNumber);
        unique.push(candidate);
      }
    }

    return unique.sort((a, b) => b.score - a.score);
  }

  private async useConstrainedLLM(input: CustomerFinderInput, candidates: ScoredCandidate[]): Promise<CustomerFinderResult> {
    // TODO: Implement constrained LLM that can only choose from provided candidates
    console.log(`   🤖 Constrained LLM not implemented yet - returning top candidate`);
    
    if (candidates.length > 0) {
      const topCandidate = candidates[0];
      return {
        status: 'found',
        customer_number: topCandidate.candidate.customerNumber,
        customer_name: topCandidate.candidate.companyName,
        confidence: topCandidate.score,
        candidates: candidates
      };
    }

    return { status: 'not_found' };
  }

  // Database search methods
  private async searchByCustomerNumber(customerNumber: string): Promise<CustomerCandidate[]> {
    // TODO: Implement actual database search
    return [];
  }

  private async searchByEmail(email: string): Promise<CustomerCandidate[]> {
    // TODO: Implement actual database search
    return [];
  }

  private async searchByDomain(domain: string): Promise<CustomerCandidate[]> {
    // TODO: Implement actual database search
    return [];
  }

  private async searchByASI(asiNumber: string): Promise<CustomerCandidate[]> {
    // TODO: Implement actual database search
    return [];
  }

  private async searchByPPAI(ppaiNumber: string): Promise<CustomerCandidate[]> {
    // TODO: Implement actual database search
    return [];
  }

  private async searchByCompanyName(companyName: string): Promise<CustomerCandidate[]> {
    // TODO: Implement actual database search
    return [];
  }

  private async searchByRootBrand(rootBrand: string): Promise<CustomerCandidate[]> {
    // TODO: Implement actual database search
    return [];
  }
}

export const scoredCustomerFinderService = new ScoredCustomerFinderService();