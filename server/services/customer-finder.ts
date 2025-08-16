import { db } from '../db';
import { customers } from '../../shared/schema';
import { eq, ilike, or, and, sql, isNotNull } from 'drizzle-orm';

interface CustomerDetails {
  customerEmail?: string;
  senderEmail?: string;
  customerName?: string;
  asiNumber?: string;
  ppaiNumber?: string;
  address?: any;
  cNumber?: string; // For direct CNumber lookups
}

interface CustomerMatch {
  customer_number: string;
  customer_name: string;
}

// Brand override mappings
const BRAND_OVERRIDES: Record<string, CustomerMatch> = {
  'adventures in advertising': { customer_number: "C12808", customer_name: "Adventures In Advertising" },
  'aia': { customer_number: "C12808", customer_name: "Adventures In Advertising" },
  'staples': { customer_number: "C1967", customer_name: "Staples" },
  'staples promotional products': { customer_number: "C1967", customer_name: "Staples" },
  'quality logo products': { customer_number: "C7657", customer_name: "Quality Logo Products" },
  'halo': { customer_number: "C2259", customer_name: "Halo Branded Solutions" },
  'halo branded solutions': { customer_number: "C2259", customer_name: "Halo Branded Solutions" },
  'ipromoteu': { customer_number: "C5286", customer_name: "iPromoteu.com" },
  'ipromoteu.com': { customer_number: "C5286", customer_name: "iPromoteu.com" },
  'bda': { customer_number: "C2436", customer_name: "Bensussen-Deutsch & Associates" },
  'bda inc': { customer_number: "C2436", customer_name: "Bensussen-Deutsch & Associates" },
  'bdainc': { customer_number: "C2436", customer_name: "Bensussen-Deutsch & Associates" }
};

export class CustomerFinderService {
  
  // Clean and normalize text for comparison
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/&/g, 'and')
      .replace(/\b(inc|llc|ltd|co|corp|company|corporation)\b/g, '')
      .replace(/\b(promotional|promo|products|marketing|printing|group|agency|solutions|services)\b/g, '')
      .trim();
  }

  // Extract root brand name
  private extractRoot(text: string): string {
    const normalized = this.normalizeText(text);
    const separators = /[:\-–/()]/;
    const firstPart = normalized.split(separators)[0].trim();
    return firstPart;
  }

  // Generate search query variations
  private generateQueries(input: string): string[] {
    const queries: string[] = [];
    
    // 1. Original text
    queries.push(input);
    
    // 2. Digit-letter split (4allpromos → 4 all promos)
    queries.push(input.replace(/(\d)([a-zA-Z])/g, '$1 $2'));
    
    // 3. Digit to word conversions
    let wordVersion = input
      .replace(/\b4\b/g, 'four')
      .replace(/\b2\b/g, 'two')
      .replace(/\b8\b/g, 'eight');
    queries.push(wordVersion);
    
    // 4. Domain guess if no domain present
    if (!input.includes('.com') && !input.includes('@')) {
      const alphanumeric = input.replace(/[^a-zA-Z0-9]/g, '');
      if (alphanumeric) {
        queries.push(`${alphanumeric}.com`);
      }
    }
    
    // 5. Root form
    queries.push(this.extractRoot(input));
    
    return Array.from(new Set(queries)); // Remove duplicates
  }

  // Check for brand overrides
  private checkBrandOverride(customerName: string, senderEmail?: string): CustomerMatch | null {
    const normalized = this.normalizeText(customerName);
    
    // Check for Canada specific override
    if (normalized.includes('staples') && (normalized.includes('canada') || senderEmail?.includes('.ca'))) {
      return { customer_number: "C136577", customer_name: "Staples / Canada" };
    }
    
    // Check standard overrides
    for (const [key, override] of Object.entries(BRAND_OVERRIDES)) {
      if (normalized.includes(key) || senderEmail?.includes(key)) {
        return override;
      }
    }
    
    return null;
  }

  // Search database with multiple strategies
  private async searchCustomers(queries: string[]): Promise<any[]> {
    const results: any[] = [];
    
    for (const query of queries) {
      try {
        // Search by customer number (exact)
        if (query.match(/^C?\d+$/)) {
          const cNumber = query.startsWith('C') ? query : `C${query}`;
          const exactMatch = await db
            .select()
            .from(customers)
            .where(eq(customers.customerNumber, cNumber))
            .limit(5);
          results.push(...exactMatch);
        }
        
        // Search by company name
        const nameMatches = await db
          .select()
          .from(customers)
          .where(
            or(
              ilike(customers.companyName, `%${query}%`),
              ilike(customers.searchVector, `%${query}%`)
            )
          )
          .limit(10);
        results.push(...nameMatches);
        
        // Search by email domain
        if (query.includes('@') || query.includes('.com')) {
          const domain = query.includes('@') ? query.split('@')[1] : query;
          const emailMatches = await db
            .select()
            .from(customers)
            .where(
              and(
                isNotNull(customers.email),
                ilike(customers.email, `%${domain}%`)
              )
            )
            .limit(5);
          results.push(...emailMatches);
        }
        
      } catch (error) {
        console.error(`Error searching with query "${query}":`, error);
      }
    }
    
    // Remove duplicates by customer number
    const uniqueResults = results.filter((customer, index, self) =>
      index === self.findIndex(c => c.customerNumber === customer.customerNumber)
    );
    
    return uniqueResults.slice(0, 10); // Top 10 results
  }

  // Main customer finding function
  async findCustomer(details: CustomerDetails): Promise<CustomerMatch> {
    console.log(`🔍 CUSTOMER FINDER: Starting lookup with details:`, {
      customerEmail: details.customerEmail,
      senderEmail: details.senderEmail,
      customerName: details.customerName,
      asiNumber: details.asiNumber,
      ppaiNumber: details.ppaiNumber,
      cNumber: details.cNumber
    });

    // Direct CNumber lookup (highest priority for forwarded emails)
    if (details.cNumber) {
      console.log(`   🎯 Direct CNumber lookup: ${details.cNumber}`);
      try {
        const directMatch = await db
          .select()
          .from(customers)
          .where(eq(customers.customerNumber, details.cNumber))
          .limit(1);
        
        if (directMatch.length > 0) {
          const match = {
            customer_number: directMatch[0].customerNumber,
            customer_name: directMatch[0].companyName
          };
          console.log(`   ✅ Direct CNumber match found:`, match);
          return match;
        } else {
          console.log(`   ❌ No direct CNumber match found for: ${details.cNumber}`);
        }
      } catch (error) {
        console.error(`   ❌ Error in direct CNumber lookup:`, error);
      }
    }

    // 1. Exact Email Match (Priority 1)
    if (details.customerEmail || details.senderEmail) {
      console.log(`   📧 Email matching...`);
      const emails = [details.customerEmail, details.senderEmail].filter(Boolean);
      
      for (const email of emails) {
        try {
          const emailMatch = await db
            .select()
            .from(customers)
            .where(
              and(
                isNotNull(customers.email),
                eq(customers.email, email!)
              )
            )
            .limit(1);
          
          if (emailMatch.length > 0) {
            const match = {
              customer_number: emailMatch[0].customerNumber,
              customer_name: emailMatch[0].companyName
            };
            console.log(`   ✅ Exact email match found:`, match);
            return match;
          }
        } catch (error) {
          console.error(`   ❌ Error in email lookup:`, error);
        }
      }
    }

    // 2. ASI/PPAI Match (Priority 2)
    // Note: Our current schema doesn't store ASI/PPAI, but we can add this later
    
    // 3. Customer Name Match (Priority 3)
    if (details.customerName) {
      console.log(`   🏢 Customer name matching: ${details.customerName}`);
      
      // Check brand overrides first
      const override = this.checkBrandOverride(details.customerName, details.senderEmail);
      if (override) {
        console.log(`   ✅ Brand override match:`, override);
        return override;
      }
      
      // Generate search queries
      const queries = this.generateQueries(details.customerName);
      console.log(`   🔍 Generated queries:`, queries);
      
      // Search database
      const candidates = await this.searchCustomers(queries);
      console.log(`   📋 Found ${candidates.length} candidates`);
      
      if (candidates.length > 0) {
        // For now, return the best match (first active customer)
        const bestMatch = candidates.find(c => c.isActive) || candidates[0];
        const match = {
          customer_number: bestMatch.customerNumber,
          customer_name: bestMatch.companyName
        };
        console.log(`   ✅ Name-based match found:`, match);
        return match;
      }
    }

    // No confident match found
    console.log(`   ❌ No confident match found`);
    return { customer_number: "", customer_name: "" };
  }

  // Convenience method for CNumber-only lookups (for forwarded emails)
  async findByCNumber(cNumber: string): Promise<CustomerMatch> {
    return this.findCustomer({ cNumber });
  }
}

export const customerFinderService = new CustomerFinderService();