import { db } from "../db";
import { customers, type Customer } from "@shared/schema";
import { eq, ilike, or, sql } from "drizzle-orm";

/**
 * High-performance customer lookup service with multiple matching strategies
 * Handles 5,000+ customer records efficiently with caching and fuzzy matching
 */
class CustomerLookupService {
  private customerCache: Map<string, Customer> = new Map();
  private companyNameIndex: Map<string, Customer> = new Map();
  private cacheExpiry = 5 * 60 * 1000; // 5 minutes
  private lastCacheUpdate = 0;

  /**
   * Initialize or refresh the in-memory cache
   */
  async refreshCache(): Promise<void> {
    console.log('🔄 Refreshing customer cache...');
    const allCustomers = await db.select().from(customers).where(eq(customers.isActive, true));
    
    this.customerCache.clear();
    this.companyNameIndex.clear();
    
    for (const customer of allCustomers) {
      // Index by customer number
      this.customerCache.set(customer.customerNumber, customer);
      
      // Index by normalized company name for fuzzy matching
      const normalizedName = this.normalizeCompanyName(customer.companyName);
      this.companyNameIndex.set(normalizedName, customer);
      
      // Index alternate names too
      if (customer.alternateNames) {
        for (const altName of customer.alternateNames) {
          const normalizedAlt = this.normalizeCompanyName(altName);
          this.companyNameIndex.set(normalizedAlt, customer);
        }
      }
    }
    
    this.lastCacheUpdate = Date.now();
    console.log(`✅ Cached ${allCustomers.length} customers`);
  }

  /**
   * Ensure cache is fresh
   */
  private async ensureFreshCache(): Promise<void> {
    if (Date.now() - this.lastCacheUpdate > this.cacheExpiry) {
      await this.refreshCache();
    }
  }

  /**
   * Strategy 1: Exact customer number lookup (fastest)
   */
  async findByCustomerNumber(customerNumber: string): Promise<Customer | null> {
    await this.ensureFreshCache();
    return this.customerCache.get(customerNumber) || null;
  }

  /**
   * Strategy 2: Company name lookup with normalization
   */
  async findByCompanyName(companyName: string): Promise<Customer | null> {
    await this.ensureFreshCache();
    const normalized = this.normalizeCompanyName(companyName);
    return this.companyNameIndex.get(normalized) || null;
  }

  /**
   * Strategy 3: Fuzzy matching with similarity scoring
   */
  async findByFuzzyMatch(companyName: string, threshold = 0.8): Promise<{ customer: Customer; similarity: number } | null> {
    await this.ensureFreshCache();
    
    let bestMatch: { customer: Customer; similarity: number } | null = null;
    const searchTerm = this.normalizeCompanyName(companyName);
    
    this.companyNameIndex.forEach((customer, indexedName) => {
      const similarity = this.calculateSimilarity(searchTerm, indexedName);
      
      if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { customer, similarity };
      }
    });
    
    return bestMatch;
  }

  /**
   * Strategy 4: Database full-text search (for complex cases)
   */
  async findByFullTextSearch(searchTerm: string): Promise<Customer[]> {
    return await db
      .select()
      .from(customers)
      .where(
        or(
          ilike(customers.companyName, `%${searchTerm}%`),
          ilike(customers.email, `%${searchTerm}%`),
          sql`${customers.alternateNames} @> ARRAY[${searchTerm}]::text[]`
        )
      )
      .limit(10);
  }

  /**
   * Main lookup method with cascading strategies
   */
  async lookupCustomer(input: {
    customerNumber?: string;
    companyName?: string;
    email?: string;
  }): Promise<{
    customer: Customer | null;
    method: 'exact_number' | 'company_exact' | 'company_fuzzy' | 'fulltext' | 'not_found';
    confidence: number;
  }> {
    // Strategy 1: Direct customer number lookup
    if (input.customerNumber) {
      const customer = await this.findByCustomerNumber(input.customerNumber);
      if (customer) {
        return { customer, method: 'exact_number', confidence: 1.0 };
      }
    }

    // Strategy 2: Company name exact match
    if (input.companyName) {
      const customer = await this.findByCompanyName(input.companyName);
      if (customer) {
        return { customer, method: 'company_exact', confidence: 0.95 };
      }

      // Strategy 3: Fuzzy matching
      const fuzzyMatch = await this.findByFuzzyMatch(input.companyName, 0.8);
      if (fuzzyMatch) {
        return { 
          customer: fuzzyMatch.customer, 
          method: 'company_fuzzy', 
          confidence: fuzzyMatch.similarity 
        };
      }
    }

    // Strategy 4: Full-text search as last resort
    if (input.companyName || input.email) {
      const searchTerm = input.companyName || input.email || '';
      const results = await this.findByFullTextSearch(searchTerm);
      if (results.length > 0) {
        return { customer: results[0], method: 'fulltext', confidence: 0.7 };
      }
    }

    return { customer: null, method: 'not_found', confidence: 0.0 };
  }

  /**
   * Normalize company names for consistent matching
   */
  private normalizeCompanyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\b(inc|llc|corp|co|ltd|company|corporation)\b/g, '') // Remove business suffixes
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Levenshtein distance implementation
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + substitutionCost // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }
}

export const customerLookupService = new CustomerLookupService();