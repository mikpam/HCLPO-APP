import { db } from "../db";
import { customers } from "@shared/schema";
import { sql, ilike, or } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

interface CustomerFinderInput {
  customerEmail?: string;
  senderEmail?: string;
  customerName?: string;
  asiNumber?: string;
  ppaiNumber?: string;
  address?: string;
}

interface CustomerFinderResult {
  customer_number: string;
  customer_name: string;
}

export class OpenAICustomerFinderService {
  
  async findCustomer(input: CustomerFinderInput): Promise<CustomerFinderResult | null> {
    console.log(`🤖 OPENAI CUSTOMER FINDER: Starting lookup with input:`, input);
    
    // Step 1: Generate search queries using expansion strategies
    const searchQueries = this.generateSearchQueries(input);
    console.log(`   📋 Generated ${searchQueries.length} search queries:`, searchQueries);
    
    // Step 2: Retrieve top candidates from database
    const candidates = await this.retrieveCandidates(searchQueries);
    console.log(`   🔍 Found ${candidates.length} database candidates`);
    
    if (candidates.length === 0) {
      console.log(`   ❌ No candidates found in database`);
      return { customer_number: "", customer_name: "" };
    }
    
    // Step 3: Use OpenAI to intelligently match with sophisticated prompt
    const result = await this.matchWithOpenAI(input, candidates);
    console.log(`   ✅ OpenAI result:`, result);
    
    return result;
  }
  
  private generateSearchQueries(input: CustomerFinderInput): string[] {
    const queries: string[] = [];
    
    // 1. Original customer name
    if (input.customerName) {
      queries.push(input.customerName);
      
      // 2. Digit-letter split (4allpromos → 4 all promos)
      const digitSplit = input.customerName.replace(/(\d)([a-zA-Z])/g, '$1 $2');
      if (digitSplit !== input.customerName) {
        queries.push(digitSplit);
      }
      
      // 3. Digit to word transformation
      let wordForm = input.customerName
        .replace(/\b4\b/g, 'four')
        .replace(/\b2\b/g, 'two')
        .replace(/\b1\b/g, 'one');
      if (wordForm !== input.customerName) {
        queries.push(wordForm);
      }
      
      // 4. Domain guess if none present
      const alphanumeric = input.customerName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (alphanumeric) {
        queries.push(`${alphanumeric}.com`);
      }
      
      // 5. Root form (remove corporate suffixes and qualifiers)
      const rootForm = this.extractRootBrand(input.customerName);
      if (rootForm !== input.customerName) {
        queries.push(rootForm);
      }
    }
    
    // 6. Email domains
    if (input.customerEmail) {
      queries.push(input.customerEmail);
      const domain = input.customerEmail.split('@')[1];
      if (domain) {
        queries.push(domain);
      }
    }
    
    if (input.senderEmail) {
      queries.push(input.senderEmail);
      const domain = input.senderEmail.split('@')[1];
      if (domain) {
        queries.push(domain);
      }
    }
    
    // 7. ASI/PPAI numbers
    if (input.asiNumber) {
      queries.push(input.asiNumber);
    }
    if (input.ppaiNumber) {
      queries.push(input.ppaiNumber);
    }
    
    // Remove duplicates and empty strings
    return Array.from(new Set(queries.filter(q => q && q.trim().length > 0)));
  }
  
  private extractRootBrand(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/&/g, 'and')
      // Remove corporate suffixes
      .replace(/\b(inc|llc|ltd|co|corp|company|corporation)\b/g, '')
      // Remove generic category words
      .replace(/\b(promotional|promo|products|marketing|printing|group|agency|solutions|services)\b/g, '')
      // Split at first separator and take left segment
      .split(/[:\/–\-\(]/)[0]
      .trim();
  }
  
  private async retrieveCandidates(queries: string[]): Promise<any[]> {
    const allCandidates: any[] = [];
    
    for (const query of queries.slice(0, 8)) { // Limit to top 8 queries
      try {
        // Search in company name, alternate names, and email
        const results = await db
          .select()
          .from(customers)
          .where(
            or(
              ilike(customers.companyName, `%${query}%`),
              sql`${customers.alternateNames} @> ARRAY[${query}]::text[]`,
              ilike(customers.email, `%${query}%`)
            )
          )
          .limit(10);
        
        allCandidates.push(...results);
      } catch (error) {
        console.error(`Error searching for query "${query}":`, error);
      }
    }
    
    // Remove duplicates by customer_number
    const uniqueCandidates = allCandidates.reduce((acc, current) => {
      const existing = acc.find(item => item.customerNumber === current.customerNumber);
      if (!existing) {
        acc.push(current);
      }
      return acc;
    }, []);
    
    return uniqueCandidates.slice(0, 10); // Return top 10 candidates
  }
  
  private async matchWithOpenAI(input: CustomerFinderInput, candidates: any[]): Promise<CustomerFinderResult> {
    const candidatesList = candidates.map(c => `${c.customerNumber}: ${c.companyName} (email: ${c.email || 'N/A'})`).join('\n');
    
    const prompt = `Customer-Finder Assistant — MASTER PROMPT (2025-08-08)

You will receive possibly incomplete customer details:

Customer Email: ${input.customerEmail || 'N/A'}
Sender Email: ${input.senderEmail || 'N/A'}
Customer Name: ${input.customerName || 'N/A'}
ASI Number: ${input.asiNumber || 'N/A'}
PPAI Number: ${input.ppaiNumber || 'N/A'}
Address: ${input.address || 'N/A'}

Your task is to find the correct customer record from the candidates provided.
Only answer when the match is confident. Never fabricate a customer number.

MATCHING PRIORITIES (highest to lowest):
1. Exact Email match - test Customer Email first, then Sender Email
2. Exact ASI or PPAI match
3. Customer Name match (be confident with obvious variations: singular/plural, case differences, punctuation)
4. Address match (only if highly confident)

ROOT-FIRST DISAMBIGUATION:
When several candidates share the same root brand but differ by qualifiers:
- Extract root by removing corporate suffixes and generic words
- If no qualifier in query, return the root/base account
- If qualifier present, return the matching affiliate
- When in doubt, choose the root account

BRAND OVERRIDES (mandatory when applicable):
- Adventures In Advertising / AIA: C12808
- Staples / Staples Promotional Products (no Canada): C1967
- Staples with Canada qualifier or .ca email: C136577
- Quality Logo Products or @qualitylogoproducts.com: C7657
- Halo / Halo Branded Solutions (no qualifier): C2259
- iPromoteU / ipromoteu.com: C5286

OUTPUT FORMAT:
Return exactly one JSON object with no markdown formatting:
{"customer_number": "C#####", "customer_name": "..."}

For no confident match:
{"customer_number": "", "customer_name": ""}

RULES:
- customer_number must start with "C" + digits
- Never return Calibre International, LLC or HCL Sales Department
- Exact email or ASI/PPAI overrides name-only evidence
- Be CONFIDENT with obvious name variations: "CREATIVE MARKETING SPECIALISTS" = "Creative Marketing Specialist"
- Singular/plural differences are the SAME company (Specialists vs Specialist)
- Case differences are the SAME company (CREATIVE vs Creative)
- Common punctuation differences are acceptable
- Only return empty fields if truly no match exists
- Do not cite sources or add explanations

AVAILABLE CUSTOMER CANDIDATES:
${candidatesList}

Please analyze the input and return the correct customer match.`;

    try {
      // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a customer matching assistant. Follow the prompt instructions exactly. Return only valid JSON with no markdown formatting."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 200
      });

      const content = response.choices[0].message.content?.trim();
      if (!content) {
        console.log(`   ⚠️  Empty response from OpenAI`);
        return { customer_number: "", customer_name: "" };
      }

      // Parse the JSON response
      try {
        const result = JSON.parse(content);
        
        // Validate the response format
        if (typeof result.customer_number === 'string' && typeof result.customer_name === 'string') {
          return result;
        } else {
          console.log(`   ⚠️  Invalid response format from OpenAI:`, result);
          return { customer_number: "", customer_name: "" };
        }
      } catch (parseError) {
        console.log(`   ⚠️  Failed to parse OpenAI response as JSON:`, content);
        return { customer_number: "", customer_name: "" };
      }
      
    } catch (error) {
      console.error(`   ❌ OpenAI API error:`, error);
      return { customer_number: "", customer_name: "" };
    }
  }
}

export const openaiCustomerFinderService = new OpenAICustomerFinderService();