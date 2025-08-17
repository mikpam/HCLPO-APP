import OpenAI from 'openai';
import { db } from '../db';
import { items } from '@shared/schema';
import { eq } from 'drizzle-orm';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ValidatedSKU {
  sku: string;
  description: string;
  itemColor: string;
  quantity: number;
  finalSKU: string;
}

export class OpenAISKUValidator {
  private normalizedSkus: Set<string> = new Set();
  private catalog: Map<string, string> = new Map();
  private isInitialized: boolean = false;

  constructor() {
    // Don't initialize in constructor - do it when needed
  }

  private async ensureInitialized() {
    if (this.isInitialized) {
      return;
    }

    try {
      console.log('🔄 Initializing SKU validator with HCL items database...');
      
      // Load all active items from the database
      const allItems = await db.select({
        finalSku: items.finalSku,
        displayName: items.displayName,
        isActive: items.isActive
      }).from(items).where(eq(items.isActive, true));

      console.log(`📦 Loaded ${allItems.length} active items from database`);

      // Build normalized SKUs set and catalog map
      allItems.forEach(item => {
        const sku = item.finalSku.toUpperCase();
        this.normalizedSkus.add(sku);
        this.catalog.set(sku, item.displayName);
      });

      this.isInitialized = true;
      console.log(`✅ SKU validator initialized with ${this.normalizedSkus.size} SKUs`);
    } catch (error) {
      console.error('❌ Error initializing SKU validator:', error);
      throw error;
    }
  }

  async validateLineItems(input: string): Promise<ValidatedSKU[]> {
    console.log('🤖 OPENAI SKU VALIDATOR: Processing line items...');
    
    // Ensure data is loaded first
    await this.ensureInitialized();

    // Pre-process: Split input by ____ separator to handle multiple line items
    const lineItems = input.split('____').map(item => item.trim()).filter(item => item.length > 0);
    console.log(`📋 Found ${lineItems.length} line items to process`);

    const allValidatedItems: ValidatedSKU[] = [];

    // Process each line item individually for better accuracy
    for (let i = 0; i < lineItems.length; i++) {
      const lineItem = lineItems[i];
      console.log(`\n🔍 Processing line item ${i + 1}:`);
      console.log(lineItem.substring(0, 100) + (lineItem.length > 100 ? '...' : ''));

      try {
        const validatedItem = await this.validateSingleLineItem(lineItem);
        allValidatedItems.push(validatedItem);
        console.log(`   ✅ Processed: "${validatedItem.sku}" → "${validatedItem.finalSKU}"`);
      } catch (error) {
        console.error(`   ❌ Error processing line item ${i + 1}:`, error);
        // Add a fallback item for failed processing
        allValidatedItems.push({
          sku: '',
          description: lineItem.substring(0, 100),
          itemColor: '',
          quantity: 1,
          finalSKU: 'OE-MISC-ITEM'
        });
      }
    }

    console.log(`\n✅ Total validated: ${allValidatedItems.length} line items`);
    return allValidatedItems;
  }

  private async validateSingleLineItem(lineItem: string): Promise<ValidatedSKU> {
    // Prepare comprehensive validation prompt with full HCL items database
    const normalizedSkusArray = Array.from(this.normalizedSkus);
    
    // Extract SKU from lineItem to show relevant SKUs in prompt
    const skuMatch = lineItem.match(/(?:sku|item|product)[\s:]*([A-Z0-9-]+)/i);
    const inputSku = skuMatch ? skuMatch[1].toUpperCase() : '';
    
    // Show relevant SKUs - if we have an input SKU, prioritize similar ones
    let relevantSkus = normalizedSkusArray.slice(0, 100);
    if (inputSku) {
      const similar = normalizedSkusArray.filter(sku => 
        sku.includes(inputSku.split('-')[0]) || inputSku.includes(sku.split('-')[0])
      );
      relevantSkus = [...similar, ...normalizedSkusArray.filter(sku => !similar.includes(sku))].slice(0, 100);
    }

    const prompt = `You are a data-validation assistant for **High Caliber Line (HCL)**.

---

### Output (strict)

Return **only** a JSON object with exactly these keys, in this order:

* \`sku\`  (string; original as seen, or empty if none)
* \`description\`  (string)
* \`itemColor\`  (string; as seen or empty)
* \`quantity\`  (integer ≥ 1; coerce if needed, see below)
* \`finalSKU\`  (string; uppercase; strictly formatted)

No markdown, no comments, no trailing text.

---

### Processing Logic

#### A) Product SKU normalization (attempt before charges)

Use case-insensitive matching. Try, in order, stopping at first hit:

1. **Exact** lookup of \`sku\` in **NormalizedSkus**.
2. **Vendor prefix removal**: drop known prefixes (\`199-\`, \`ALLP-\`, \`4AP-\`); re-attempt exact lookup.
3. **Non-color suffix removal**: drop known non-color suffixes (\`-FD\`, \`-SS\`); re-attempt exact lookup.
4. **Trailing-letter drop**: if \`sku\` ends with \`[A-Z]\`, drop one letter and retry exact lookup; may repeat once more (max two drops).

If any step hits, treat that as the product match candidate and use the ORIGINAL SKU as finalSKU.

---

#### B) Charge codes (explicit tokens first, then phrases)

Run **only if Section A found no accepted product match**.

**B1. Explicit code tokens (highest priority)**
If the line contains any of these as a **standalone token** (case-insensitive; bounded by start/end, space, tab, comma, slash, colon, or parentheses), map directly to that code:

\`48-RUSH\`, \`LTM\`, \`CCC\`, \`DB\`, \`DDP\`, \`DP\`, \`DS\`, \`EC\`, \`ED\`, \`EL\`, \`HT\`, \`ICC\`, \`LE\`, \`P\`, \`PC\`, \`PE\`, \`PMS\`, \`PP\`, \`R\`, \`SETUP\`, \`SPEC\`, \`SR\`, \`VD\`, \`VI\`, \`X\`

Special handling:

* Accept \`"SET UP"\`, \`"SET-UP"\`, \`"setup"\`, or \`"setup charge"\` → \`SETUP\`.
* Accept \`"OE-MISC-CHARGE"\` or \`"OE-MISC-ITEM"\` only as placeholders → ignore them and re-run phrase mapping below (e.g., \`"Exact count"\` → \`X\`).
* Accept \`48-RUSH\` if you see either the exact token **or** both "48" and "rush" in context.
* For single-letter codes \`P\`, \`R\`, \`X\`, require isolation by boundaries (not part of another token).

**B2. Phrase synonyms (second priority)**
If B1 didn't fire, map common phrases to the same codes:

* \`X\`: "exact quantity", "no overrun", "no underrun", "exact qty", "exact count"
* \`SETUP\`: "setup", "set up", "setup charge"
* \`48-RUSH\`: "48 hour rush", "48hr rush", "48 hours rush", "2 day rush"
* \`P\`: "digital proof", "e-proof", "electronic proof"
* \`R\`: "rush charge", "rush service", "expedite fee"

If a charge code is selected, set \`finalSKU\` to that code and finish this item.

---

#### C) Fuzzy matching fallback

If no product or charge code found, use semantic similarity between description and catalog names. Accept if similarity ≥ 0.75.

If still no match, use \`OE-MISC-ITEM\`.

---

### Available Data

**NormalizedSkus (Relevant)**: ${JSON.stringify(relevantSkus)}

**Sample Catalog**: ${JSON.stringify(Object.fromEntries(Array.from(this.catalog.entries()).slice(0, 20)))}

---

### Input Line Item:
${lineItem}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system", 
          content: "Return only valid JSON object. No markdown, no comments."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from OpenAI');
    }

    try {
      const result = JSON.parse(content) as ValidatedSKU;
      return result;
    } catch (parseError) {
      console.error('❌ Error parsing OpenAI JSON response:', content);
      throw new Error('Invalid JSON response from OpenAI');
    }
  }

  // Helper method to check if a SKU exists in the database
  isValidSKU(sku: string): boolean {
    return this.normalizedSkus.has(sku.toUpperCase());
  }

  // Helper method to get product description by SKU
  getProductDescription(sku: string): string | undefined {
    return this.catalog.get(sku.toUpperCase());
  }

  // Get stats about the loaded catalog
  getStats() {
    return {
      totalSkus: this.normalizedSkus.size,
      totalCatalogEntries: this.catalog.size
    };
  }
}

// Create singleton instance
export const skuValidator = new OpenAISKUValidator();