import { db } from "../db";
import { customers } from "@shared/schema";
import { sql, ilike, or } from "drizzle-orm";
import OpenAI from "openai";
import { storage } from "../storage";

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
  status: 'found' | 'not_found' | 'error';
  confidence?: number;
  method?: string;
}

export class OpenAICustomerFinderService {
  
  async findCustomer(input: CustomerFinderInput): Promise<CustomerFinderResult> {
    console.log(`🤖 OPENAI CUSTOMER FINDER: Starting lookup with input:`, input);
    
    try {
      // Clean and validate input data
      const cleanedInput = this.cleanInputData(input);
      console.log(`   🧹 Cleaned input:`, cleanedInput);
      
      // Step 0: Check brand overrides first for reliability
      const brandOverride = this.checkBrandOverrides(cleanedInput);
      if (brandOverride) {
        console.log(`   ✅ Brand override found: ${brandOverride.customer_name} (${brandOverride.customer_number})`);
        return { ...brandOverride, status: 'found', confidence: 1.0, method: 'brand_override' };
      }
      
      // Step 1: Generate search queries using expansion strategies
      const searchQueries = this.generateSearchQueries(cleanedInput);
      console.log(`   📋 Generated ${searchQueries.length} search queries:`, searchQueries);
      
      // Step 2: Retrieve top candidates from database
      const candidates = await this.retrieveCandidates(searchQueries);
      console.log(`   🔍 Found ${candidates.length} database candidates`);
      
      if (candidates.length === 0) {
        console.log(`   ❌ No candidates found in database`);
        return { customer_number: "", customer_name: "", status: 'not_found', confidence: 0, method: 'database_search' };
      }
      
      // Step 3: Use OpenAI to intelligently match with sophisticated prompt
      const result = await this.matchWithOpenAI(cleanedInput, candidates);
      console.log(`   ✅ OpenAI result:`, result);
      
      // Add status and confidence based on result
      if (result.customer_number && result.customer_name) {
        return { ...result, status: 'found', confidence: 0.95, method: 'openai_match' };
      } else {
        return { ...result, status: 'not_found', confidence: 0, method: 'openai_match' };
      }
    } catch (error) {
      console.error(`   ❌ Customer finder error:`, error);
      return { customer_number: "", customer_name: "", status: 'error', confidence: 0, method: 'error' };
    }
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

  private checkBrandOverrides(input: CustomerFinderInput): { customer_number: string; customer_name: string } | null {
    const customerName = (input.customerName || '').toLowerCase();
    const customerEmail = (input.customerEmail || '').toLowerCase();
    const senderEmail = (input.senderEmail || '').toLowerCase();
    
    // Adventures In Advertising / AIA
    if (customerName.includes('adventures in advertising') || customerName.includes('aia') ||
        customerEmail.includes('adventures') || senderEmail.includes('adventures') ||
        customerName.includes('kmoa') || input.customerName?.toLowerCase().includes('kmoa') ||
        customerEmail.includes('aiacorporation') || senderEmail.includes('aiacorporation') ||
        customerEmail.includes('mypromooffice') || senderEmail.includes('mypromooffice')) {
      return { customer_number: "C12808", customer_name: "Adventures In Advertising" };
    }
    
    // Staples - check for Canada qualifier
    if (customerName.includes('staples') || customerEmail.includes('staples') || senderEmail.includes('staples')) {
      // Check for Canada qualifier or .ca domain
      if (customerName.includes('canada') || customerEmail.endsWith('.ca') || senderEmail.endsWith('.ca')) {
        return { customer_number: "C136577", customer_name: "Staples / Canada" };
      } else {
        return { customer_number: "C1967", customer_name: "Staples" };
      }
    }
    
    // Quality Logo Products
    if (customerName.includes('quality logo products') || 
        customerEmail.includes('qualitylogoproducts.com') || 
        senderEmail.includes('qualitylogoproducts.com')) {
      return { customer_number: "C7657", customer_name: "Quality Logo Products" };
    }
    
    // Halo / Halo Branded Solutions
    if (customerName.includes('halo branded solutions') || customerName.includes('halo') ||
        customerEmail.includes('halo') || senderEmail.includes('halo')) {
      return { customer_number: "C2259", customer_name: "Halo Branded Solutions" };
    }
    
    // iPromoteU
    if (customerName.includes('ipromoteu') || 
        customerEmail.includes('ipromoteu.com') || 
        senderEmail.includes('ipromoteu.com')) {
      return { customer_number: "C5286", customer_name: "iPromoteu.com" };
    }
    
    // 4AllPromos / 4 All Promos LLC
    if (customerName.includes('4allpromos') || customerName.includes('4 all promos') ||
        customerEmail.includes('4allpromos.com') || senderEmail.includes('4allpromos.com')) {
      return { customer_number: "C4211", customer_name: "4 All Promos LLC" };
    }
    
    return null; // No brand override found
  }

  private cleanInputData(input: CustomerFinderInput): CustomerFinderInput {
    return {
      customerName: input.customerName?.trim(),
      customerEmail: this.cleanEmail(input.customerEmail),
      senderEmail: this.cleanEmail(input.senderEmail),
      asiNumber: input.asiNumber?.trim(),
      ppaiNumber: input.ppaiNumber?.trim(),
      address: input.address?.trim()
    };
  }

  private cleanEmail(email?: string): string | undefined {
    if (!email) return undefined;
    
    // Remove nested quotes and angle brackets
    let cleaned = email.trim();
    
    // Handle malformed emails like: "Name" <"Name" <email@domain.com>>
    const emailMatch = cleaned.match(/<([^<>]+@[^<>]+)>/);
    if (emailMatch) {
      return emailMatch[1];
    }
    
    // Handle simple email addresses
    if (cleaned.includes('@')) {
      return cleaned;
    }
    
    return cleaned;
  }
  
  private async retrieveCandidates(queries: string[]): Promise<any[]> {
    const allCandidates: any[] = [];
    
    for (const query of queries.slice(0, 8)) { // Limit to top 8 queries
      try {
        // Sanitize query to prevent SQL injection and syntax errors
        const sanitizedQuery = query.replace(/[<>'"$@()]/g, '').trim();
        if (sanitizedQuery.length === 0) continue;
        
        // Search in company name, alternate names, and email using parameterized queries
        const results = await db
          .select()
          .from(customers)
          .where(
            or(
              ilike(customers.companyName, sql`'%' || ${sanitizedQuery} || '%'`),
              ilike(customers.email, sql`'%' || ${sanitizedQuery} || '%'`)
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
  
  private async matchWithOpenAI(input: CustomerFinderInput, candidates: any[]): Promise<{ customer_number: string; customer_name: string }> {
    // First, check for brand overrides before processing candidates
    const brandOverride = this.checkBrandOverrides(input);
    if (brandOverride) {
      console.log(`   🎯 Brand override applied: ${brandOverride.customer_name}`);
      return brandOverride;
    }
    
    const candidatesList = candidates.map(c => 
      `${c.customerNumber}: ${c.companyName} (email: ${c.email || 'N/A'})`
    ).join('\n');
    
    const prompt = `Customer-Finder Assistant - MASTER PROMPT (2025-08-08)

You will receive possibly incomplete customer details:

Customer Email: ${input.customerEmail || 'N/A'}
Sender's Email: ${input.senderEmail || 'N/A'}
Customer Name: ${input.customerName || 'N/A'}
ASI Number: ${input.asiNumber || 'N/A'}
PPAI Number: ${input.ppaiNumber || 'N/A'}
Address: ${input.address || 'N/A'}

Your task is to find the correct customer record from the candidates below.
Only answer when the match is confident. Never fabricate a customer number.

MATCHING PRIORITIES (highest to lowest):
1. Exact Email match - test Customer Email first, then Sender's Email
2. Exact ASI or PPAI match
3. Customer Name match (only if highly confident)
4. Address match (only if highly confident)

ROOT-FIRST DISAMBIGUATION:
When several candidates share the same root brand but differ by qualifiers:
- Extract root: lowercase, trim, replace & with and, drop corporate suffixes (inc, llc, ltd, co, corp, company, corporation)
- Remove generic words: promotional, promo, products, marketing, printing, group, agency, solutions, services
- Split at first separator and take left segment
- No qualifier in query = return root/base account (shortest unqualified name)
- Qualifier present = return matching affiliate
- When in doubt, choose the root account

BRAND OVERRIDES (mandatory):
- Adventures In Advertising / AIA / KMOA / @mypromooffice.com: {"customer_number": "C12808", "customer_name": "Adventures In Advertising"}
- Staples (no Canada qualifier & not .ca): {"customer_number": "C1967", "customer_name": "Staples"}
- Staples with Canada qualifier or .ca email: {"customer_number": "C136577", "customer_name": "Staples / Canada"}
- Quality Logo Products or @qualitylogoproducts.com: {"customer_number": "C7657", "customer_name": "Quality Logo Products"}
- Halo / Halo Branded Solutions (no qualifier): {"customer_number": "C2259", "customer_name": "Halo Branded Solutions"}
- iPromoteU / ipromoteu.com: {"customer_number": "C5286", "customer_name": "iPromoteu.com"}
- 4AllPromos / 4 All Promos LLC: {"customer_number": "C4211", "customer_name": "4 All Promos LLC"}

OUTPUT FORMAT:
Confident match: {"customer_number": "C#####", "customer_name": "..."}
No confident match: {"customer_number": "", "customer_name": ""}

RULES:
- customer_number must start with "C" + digits
- Never return Calibre International, LLC or HCL Sales Department
- Exact email or ASI/PPAI overrides name-only evidence
- Do not cite sources or add explanations
- Do not guess; if uncertain, return empty-fields JSON

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
            content: "You are a customer matching assistant. Follow the prompt instructions exactly. Return ONLY raw JSON without any markdown code blocks, backticks, or formatting. Do not wrap your response in ```json or any other markers."
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

      // Parse the JSON response - handle markdown code blocks
      try {
        let jsonContent = content;
        
        // Remove markdown code blocks if present
        if (content.includes('```json')) {
          const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            jsonContent = jsonMatch[1].trim();
          }
        } else if (content.includes('```')) {
          const codeMatch = content.match(/```\s*([\s\S]*?)\s*```/);
          if (codeMatch) {
            jsonContent = codeMatch[1].trim();
          }
        }
        
        const result = JSON.parse(jsonContent);
        
        // Validate the response format and customer number format
        if (typeof result.customer_number === 'string' && typeof result.customer_name === 'string') {
          // Validate customer number format: must be empty OR start with "C" followed by digits
          const isValidCustomerNumber = result.customer_number === '' || /^C\d+$/.test(result.customer_number);
          
          if (!isValidCustomerNumber) {
            console.log(`   ❌ Invalid customer number format from OpenAI: "${result.customer_number}" - must be empty or start with "C" followed by digits`);
            return { customer_number: "", customer_name: "" };
          }
          
          console.log(`   ✅ Successfully parsed OpenAI response: ${result.customer_name} (${result.customer_number})`);
          console.log(`   🔍 Debug: Raw OpenAI content was: "${content}"`);
          return result;
        } else {
          console.log(`   ⚠️  Invalid response format from OpenAI:`, result);
          return { customer_number: "", customer_name: "" };
        }
      } catch (parseError) {
        console.log(`   ⚠️  Failed to parse OpenAI response as JSON:`, content);
        console.log(`   🔍 Raw content:`, content);
        console.log(`   🔍 Parse error:`, parseError);
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
      console.log(`   🔍 DEBUG: extractedData structure:`, JSON.stringify(extractedData, null, 2));
      
      if (!extractedData || !extractedData.purchaseOrder) {
        console.log(`   ❌ No extracted data found for PO ${purchaseOrderId}`);
        console.log(`   🔍 DEBUG: extractedData exists:`, !!extractedData);
        console.log(`   🔍 DEBUG: extractedData.purchaseOrder exists:`, !!extractedData?.purchaseOrder);
        return purchaseOrder;
      }
      
      const customerData = extractedData.purchaseOrder.customer;
      console.log(`   🔍 DEBUG: customerData from extractedData:`, JSON.stringify(customerData, null, 2));
      if (!customerData) {
        console.log(`   ❌ No customer data found in PO ${purchaseOrderId}`);
        console.log(`   🔍 DEBUG: Available extractedData keys:`, Object.keys(extractedData));
        console.log(`   🔍 DEBUG: Available purchaseOrder keys:`, Object.keys(extractedData.purchaseOrder || {}));
        return purchaseOrder;
      }
      
      // Prepare input for customer finder
      const customerFinderInput: CustomerFinderInput = {
        customerEmail: customerData.email,
        senderEmail: purchaseOrder.sender || undefined,
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
        console.log(`   🔍 DEBUG: About to store customer_lookup:`, JSON.stringify(updatedData.customer_lookup, null, 2));
        const updatedPO = await storage.updatePurchaseOrder(purchaseOrderId, {
          extractedData: updatedData,
          status: 'customer_found'
        });
        
        console.log(`   ✅ Storing customer data from lookup: ${foundCustomer.customer_name} (${foundCustomer.customer_number})`);
        console.log(`   🔍 DEBUG: Updated PO status:`, updatedPO?.status);
        
        return updatedPO;
      } else {
        console.log(`   ⚠️  No customer match found for PO ${purchaseOrderId}`);
        
        // Update status to indicate new customer requires setup
        const updatedPO = await storage.updatePurchaseOrder(purchaseOrderId, {
          status: 'new customer'
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