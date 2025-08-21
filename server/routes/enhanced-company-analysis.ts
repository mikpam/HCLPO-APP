import { Router } from "express";
import OpenAI from "openai";
import { db } from "../db";
import { contacts, customers } from "../../shared/schema";
import { sql } from "drizzle-orm";

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface CompanyMatchAnalysis {
  contactCompany: string;
  potentialMatches: Array<{
    customerName: string;
    customerNumber: string;
    confidence: number;
    reasoning: string;
  }>;
  isGenuinelyMissing: boolean;
  aiReasoning: string;
}

// Enhanced OpenAI-powered company matching analysis
router.post("/enhanced-analysis", async (req, res) => {
  try {
    console.log("🔍 ENHANCED COMPANY ANALYSIS: Starting OpenAI-powered analysis...");
    
    // Get all unique contact companies
    const contactCompaniesResult = await db
      .select({
        company: sql<string>`DISTINCT TRIM(${contacts.company})`.as('company')
      })
      .from(contacts)
      .where(sql`${contacts.company} IS NOT NULL AND TRIM(${contacts.company}) != ''`);

    const contactCompanies = contactCompaniesResult.map((r: any) => r.company);
    console.log(`📊 Found ${contactCompanies.length} unique contact companies`);

    // Get all customer companies
    const customerCompaniesResult = await db
      .select({
        customerNumber: customers.customerNumber,
        companyName: customers.companyName
      })
      .from(customers)
      .where(sql`${customers.companyName} IS NOT NULL AND TRIM(${customers.companyName}) != ''`);

    console.log(`📊 Found ${customerCompaniesResult.length} customer companies`);

    // Process in batches to avoid overwhelming OpenAI
    const batchSize = 20;
    const results: CompanyMatchAnalysis[] = [];
    const genuinelyMissing: string[] = [];
    const falsePositives: string[] = [];

    for (let i = 0; i < Math.min(contactCompanies.length, 100); i += batchSize) {
      const batch = contactCompanies.slice(i, i + batchSize);
      console.log(`🤖 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(Math.min(contactCompanies.length, 100)/batchSize)} (${batch.length} companies)`);

      const batchResults = await analyzeCompanyBatch(batch, customerCompaniesResult);
      results.push(...batchResults);

      // Categorize results
      batchResults.forEach(result => {
        if (result.isGenuinelyMissing) {
          genuinelyMissing.push(result.contactCompany);
        } else {
          falsePositives.push(result.contactCompany);
        }
      });

      // Add small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ ENHANCED ANALYSIS COMPLETE: ${genuinelyMissing.length} genuinely missing, ${falsePositives.length} false positives`);

    res.json({
      summary: {
        totalAnalyzed: results.length,
        genuinelyMissing: genuinelyMissing.length,
        falsePositives: falsePositives.length,
        accuracyImprovement: `${Math.round((falsePositives.length / results.length) * 100)}% of "missing" companies were actually false positives`
      },
      genuinelyMissingCompanies: genuinelyMissing,
      falsePositives: falsePositives,
      detailedResults: results
    });

  } catch (error) {
    console.error("❌ Enhanced analysis error:", error);
    res.status(500).json({ error: "Enhanced analysis failed" });
  }
});

async function analyzeCompanyBatch(
  contactCompanies: string[], 
  customerCompanies: Array<{customerNumber: string; companyName: string}>
): Promise<CompanyMatchAnalysis[]> {
  
  const prompt = `You are an expert company name matching analyst. Your task is to determine if contact companies are genuinely missing from the customer database or if they exist under different names.

CONTACT COMPANIES TO ANALYZE:
${contactCompanies.map((company, i) => `${i + 1}. "${company}"`).join('\n')}

CUSTOMER DATABASE COMPANIES (sample of ${Math.min(customerCompanies.length, 500)}):
${customerCompanies.slice(0, 500).map(c => `${c.customerNumber}: "${c.companyName}"`).join('\n')}

For each contact company, analyze:
1. Does it match any customer company (considering variations like abbreviations, punctuation, word order)?
2. What are the potential matches and confidence levels?
3. Is this contact company genuinely missing from the customer database?

Common variations to consider:
- Abbreviations: "Inc" vs "Incorporated", "LLC" vs "Limited Liability Company"
- Punctuation: "Smith & Jones" vs "Smith and Jones" vs "Smith, Jones"
- Word order: "Marketing Solutions ABC" vs "ABC Marketing Solutions"
- Business suffixes: presence/absence of Inc, LLC, Corp, etc.
- Common business words: "Company", "Corporation", "Enterprises", etc.

Return a JSON array with this exact structure:
[
  {
    "contactCompany": "exact company name from contact list",
    "potentialMatches": [
      {
        "customerName": "matching customer company name",
        "customerNumber": "customer number",
        "confidence": 0.95,
        "reasoning": "exact match except for Inc vs Incorporated"
      }
    ],
    "isGenuinelyMissing": false,
    "aiReasoning": "Found strong match with Customer C1234 - same company with different business suffix"
  }
]

Be strict: only mark as "genuinelyMissing: true" if you cannot find ANY reasonable match in the customer database.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are a precise company name matching expert. Always return valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    // Parse the JSON response
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(content);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Raw response:", content);
      throw new Error("Invalid JSON response from OpenAI");
    }

    // Handle both array and object responses
    const results = Array.isArray(jsonResponse) ? jsonResponse : 
                   jsonResponse.results || jsonResponse.analysis || [];

    return results as CompanyMatchAnalysis[];

  } catch (error) {
    console.error("OpenAI analysis error:", error);
    // Return fallback results
    return contactCompanies.map(company => ({
      contactCompany: company,
      potentialMatches: [],
      isGenuinelyMissing: true,
      aiReasoning: "Analysis failed - marked as missing by default"
    }));
  }
}

export default router;