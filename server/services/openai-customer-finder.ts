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
      const existing = acc.find((item: any) => item.customerNumber === current.customerNumber);
      if (!existing) {
        acc.push(current);
      }
      return acc;
    }, []);
    
    return uniqueCandidates.slice(0, 10); // Return top 10 candidates
  }
  
  private async matchWithOpenAI(input: CustomerFinderInput, candidates: any[]): Promise<CustomerFinderResult> {
    const candidatesList = candidates.map(c => `${c.customerNumber}: ${c.companyName} (email: ${c.email || 'N/A'})`).join('\n');
    

    
    const prompt = `**Customer-Finder Assistant — MASTER PROMPT (2025-08-08)**

You will receive *possibly incomplete* customer details:

* **Customer Email**: ${input.customerEmail || 'N/A'}
* **Sender's Email**: ${input.senderEmail || 'N/A'}
* **Customer Name**: ${input.customerName || 'N/A'}
* **ASI Number**: ${input.asiNumber || 'N/A'}
* **PPAI Number**: ${input.ppaiNumber || 'N/A'}
* **Address**: ${input.address || 'N/A'}

Your task is to query the indexed customer store (vector / keyword / DB) and return the correct customer record.
Only answer when the match is confident. **Never fabricate a customer number.**

---

### 1 MATCHING PRIORITIES ( highest → lowest )

1. **Exact Email match** – test *Customer Email* first, then *Sender's Email*. Email domain match (same domain = same company) counts as email match.
2. **Exact ASI or PPAI** match.
3. **Customer Name** match (*only if highly confident*).
4. **Address** match (*only if highly confident*).

---

### 2 ROOT-FIRST DISAMBIGUATION ( generic rule )

When several candidates share the same **root brand** but differ by qualifiers (affiliate / division / location):

1. **Extract root** for both query and candidate

   * lower-case, trim, collapse whitespace
   * replace "&" with "and"; drop corporate suffixes (inc, llc, ltd, co, corp, company, corporation)
   * remove generic category words (promotional, promo, products, marketing, printing, group, agency, solutions, services)
   * split at the first separator - left segment = root

2. **Identify qualifiers** – tokens beyond the root (affiliate names, regions, country/state abbreviations, text after separators).

3. **Decision**

   * No qualifier in query - return the root/base account (shortest unqualified name).
   * Qualifier present in query OR email/TLD - return the matching affiliate.
   * If same-root candidates remain ambiguous and no exact email/ASI/PPAI decides - pick the root/base.
   * If ambiguity spans different roots - return empty (do not guess).

Core principle: when in doubt, choose the root account.

---

### 3 BRAND OVERRIDES ( mandatory )

- Adventures In Advertising / AIA: {"customer_number": "C12808", "customer_name": "Adventures In Advertising"}
- Staples / Staples Promotional Products (no "Canada" qualifier & not .ca): {"customer_number": "C1967", "customer_name": "Staples"}
- Staples with "Canada" qualifier or .ca email: {"customer_number": "C136577", "customer_name": "Staples / Canada"}
- Quality Logo Products or @qualitylogoproducts.com: {"customer_number": "C7657", "customer_name": "Quality Logo Products"}
- Halo / Halo Branded Solutions (no qualifier): {"customer_number": "C2259", "customer_name": "Halo Branded Solutions"}
- iPromoteU / ipromoteu.com: {"customer_number": "C5286", "customer_name": "iPromoteu.com"}

Apply an override only when the input lacks a conflicting qualifier or a decisive exact email / ASI / PPAI.

---

### 4 RETRIEVAL – QUERY EXPANSION ( must do )

Before deciding, issue **5–8 search queries**:

1. Original text.
2. Digit-letter split: 4allpromos becomes 4 all promos.
3. Digit to word & homophones: 4 becomes four/for, 2 becomes two/to/too, etc.
4. Domain guess if none present: <alphanumeric>.com.
5. Root form (see section 2).
6. Each provided ASI / PPAI / email / email-domain as independent queries.

Retrieve top 10 chunks; filter by metadata where available (email_domain, search_key).
If retrieval returns zero candidates, output the empty-fields JSON.

---

### 5 OUTPUT FORMAT ( strict — NO MARKDOWN )

Confident match:
{"customer_number": "C#####", "customer_name": "..."}

No confident match:
{"customer_number": "", "customer_name": ""}

Rules for this section:
* Respond with exactly one JSON object - no keys besides customer_number and customer_name.
* Do not wrap the object in triple back-ticks, json code blocks, quote blocks, or any other markdown.
* The object must be valid JSON if copied as-is.
* If you cannot comply, return the empty-fields JSON.

---

### 6 RULES & GUARDRAILS

* customer_number must start with "C" + digits (e.g., C12345).
* Never return Calibre International, LLC or HCL Sales Department.
* Exact email (including domain match) or ASI / PPAI overrides name-only evidence.
* Email domain match means same company: office@cms-4you.com = tracy@cms-4you.com (both cms-4you.com domain).
* Name variations like singular/plural are the same company: "CREATIVE MARKETING SPECIALISTS" = "Creative Marketing Specialist".
* Do not cite sources or add explanations.
* Do not guess; if uncertain after applying all rules, return the empty-fields JSON.

### AVAILABLE CUSTOMER CANDIDATES:

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
  
  // Process a purchase order by updating it with customer information
  async processPurchaseOrder(purchaseOrderId: string): Promise<any> {
    console.log(`🤖 CUSTOMER PROCESSING: Starting for PO ${purchaseOrderId}`);
    
    try {
      // Get the purchase order
      const purchaseOrder = await storage.getPurchaseOrder(purchaseOrderId);
      if (!purchaseOrder) {
        console.log(`   ❌ Purchase order not found: ${purchaseOrderId}`);
        return null;
      }
      
      // Extract customer information from the extracted data
      const extractedData = purchaseOrder.extractedData as any;
      if (!extractedData || !extractedData.purchaseOrder) {
        console.log(`   ❌ No extracted data found for PO ${purchaseOrderId}`);
        return purchaseOrder;
      }
      
      const customerData = extractedData.purchaseOrder.customer;
      if (!customerData) {
        console.log(`   ❌ No customer data found in PO ${purchaseOrderId}`);
        return purchaseOrder;
      }
      
      // Prepare input for customer finder
      const customerFinderInput: CustomerFinderInput = {
        customerEmail: customerData.email,
        senderEmail: purchaseOrder.sender,
        customerName: customerData.company || customerData.customerName,
        asiNumber: extractedData.purchaseOrder.asiNumber,
        ppaiNumber: extractedData.purchaseOrder.ppaiNumber,
        address: `${customerData.address1 || ''} ${customerData.city || ''} ${customerData.state || ''}`.trim()
      };
      
      // Find the customer
      const foundCustomer = await this.findCustomer(customerFinderInput);
      
      if (foundCustomer && foundCustomer.customer_number) {
        console.log(`   ✅ Customer found: ${foundCustomer.customer_name} (${foundCustomer.customer_number})`);
        
        // Update the purchase order with customer information
        const updatedData = {
          ...extractedData,
          customer_lookup: {
            customer_number: foundCustomer.customer_number,
            customer_name: foundCustomer.customer_name,
            matched_at: new Date().toISOString()
          }
        };
        
        // Update the purchase order
        const updatedPO = await storage.updatePurchaseOrder(purchaseOrderId, {
          extractedData: updatedData,
          status: 'customer_found'
        });
        
        return updatedPO;
      } else {
        console.log(`   ⚠️  No customer match found for PO ${purchaseOrderId}`);
        
        // Update status to indicate no customer found
        const updatedPO = await storage.updatePurchaseOrder(purchaseOrderId, {
          status: 'customer_not_found'
        });
        
        return updatedPO;
      }
      
    } catch (error) {
      console.error(`   ❌ Error processing customer for PO ${purchaseOrderId}:`, error);
      return null;
    }
  }
}

export const openaiCustomerFinderService = new OpenAICustomerFinderService();