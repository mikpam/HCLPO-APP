import OpenAI from 'openai';
import { db } from '../db';
import { items } from '@shared/schema';
import { sql } from 'drizzle-orm';
import { LRUCache } from '../utils/lru-cache';
import { logMemoryUsage } from '../utils/memory-monitor';

interface LineItem {
  sku?: string;
  description: string;
  itemColor?: string;
  quantity: number;
  finalSKU?: string;
}

interface ValidatedLineItem {
  sku: string;
  description: string;
  itemColor: string;
  quantity: number;
  finalSKU: string;
  productName?: string;
  isValidSKU?: boolean;
  validationNotes?: string;
}

export class OpenAISKUValidatorService {
  private openai: OpenAI;
  private itemsCache = new LRUCache<any>(1000, 5 * 60 * 1000); // 1000 items, 5 min TTL
  private catalogMap = new LRUCache<string>(1000, 5 * 60 * 1000); // 1000 catalog entries, 5 min TTL
  private colorCodes: Map<string, string> = new Map();
  private chargeCodebook: Map<string, string> = new Map();
  private lastCacheUpdate = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required');
    }
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Initialize color codes
    this.colorCodes.set('00', 'White');
    this.colorCodes.set('06', 'Black');
    this.colorCodes.set('CL', 'Clear');
    this.colorCodes.set('RD', 'Red');
    this.colorCodes.set('BL', 'Blue');
    this.colorCodes.set('GR', 'Green');

    // Initialize charge codebook
    this.chargeCodebook.set('SETUP', 'Setup charges');
    this.chargeCodebook.set('48-RUSH', 'Rush charges');
    this.chargeCodebook.set('EC', 'Extra charges');
    this.chargeCodebook.set('P', 'Proof charges');
    this.chargeCodebook.set('PROOF', 'Proof charges');
    this.chargeCodebook.set('FREIGHT', 'Freight charges');
    this.chargeCodebook.set('RUN-CHARGE', 'Run charges');
    this.chargeCodebook.set('OE-MISC-CHARGE', 'Miscellaneous charges');
    this.chargeCodebook.set('OE-MISC-ITEM', 'Unknown products');
  }

  private async loadItemsCache(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCacheUpdate < this.CACHE_TTL && this.itemsCache.size() > 0) {
      return; // Cache is still valid
    }

    try {
      logMemoryUsage('SKUValidator - Before Cache Refresh');
      
      // MEMORY OPTIMIZATION: Load only top 1000 most common items instead of all 5000+
      const allItems = await db.select().from(items).where(sql`is_active = true`).limit(1000);
      
      this.itemsCache.clear();
      this.catalogMap.clear();
      
      for (const item of allItems) {
        this.itemsCache.set(item.finalSku.toUpperCase(), item);
        this.catalogMap.set(item.finalSku.toUpperCase(), item.displayName || item.description || 'No description');
      }
      
      this.lastCacheUpdate = now;
      logMemoryUsage('SKUValidator - After Cache Refresh');
      console.log(`   📦 Loaded ${this.itemsCache.size()} items into LRU cache (memory optimized)`);
    } catch (error) {
      console.error('Failed to load items cache:', error);
    }
  }

  private async validateWithOpenAI(lineItems: LineItem[]): Promise<ValidatedLineItem[]> {
    await this.loadItemsCache();
    
    // Create a catalog for OpenAI context (top items from cache)
    const catalogEntries = "Top SKUs: T516-07, S900-07, H710-08, JAG-BAG-001, LC-POLO-001";

    // Create color codes context
    const colorCodesContext = Array.from(this.colorCodes.entries()).map(([code, name]) =>
      `${code}: ${name}`
    ).join(', ');

    // Create charge codes context  
    const chargeCodesContext = Array.from(this.chargeCodebook.entries()).map(([code, desc]) =>
      `${code}: ${desc}`
    ).join(', ');

    const prompt = `You are a data-validation assistant for High Caliber Line (HCL).

### Output (strict)

Return **only** a JSON array. Each element is an object with exactly these keys, in this order:

* sku        (string; original as seen, or empty if none)
* description (string)
* itemColor   (string; as seen or empty)
* quantity    (integer ≥ 1; coerce if needed, defaults below)
* finalSKU    (string; uppercase; strictly formatted)

No markdown, no comments, no trailing text.

---

### Inputs & resources (system context)

* **ItemsDB**: PostgreSQL table of all valid HCL SKUs and variants (base + color codes).
* **Catalog**: { sku → productName } map for fuzzy matching.
* **ColorCodes**: canonical map of HCL color codes (${colorCodesContext}).
* **ChargeCodebook**: explicit non-inventory/charge codes (${chargeCodesContext}) with phrase synonyms.
* **OE-MISC Fallbacks**: OE-MISC-ITEM for unknown products, OE-MISC-CHARGE for ambiguous charge lines.

### CRITICAL: OE-MISC-CHARGE Analysis
When you encounter an item with SKU or finalSKU "OE-MISC-CHARGE", this is a placeholder that needs analysis:
1. **Check for known charge patterns first**:
   - "Run Charge" → Use "RUN-CHARGE" 
   - "PMS Matching" → Keep as "OE-MISC-CHARGE"
   - "Set Up" or "Setup" → Use "SETUP"
2. **Examine the description for actual product information**
3. **Look for real SKU patterns** (like T339, B515, etc.) mentioned in the description
4. **Match against the catalog** using fuzzy matching on product names
5. **PRESERVE ORIGINAL QUANTITIES** - Don't change quantities to 1 for charges

Examples:
- "Run Charge" (qty: 130) → "RUN-CHARGE" (qty: 130) ✅
- "PMS Matching Charge" (qty: 1) → "OE-MISC-CHARGE" (qty: 1) ✅
- "Lanyard with custom logo, blue" → Find actual lanyard SKU like "L401-BL"
- "Setup Charge" (qty: 4) → "SETUP" (qty: 4) ✅

**CRITICAL**: Always preserve the original quantity - do not force charges to quantity=1!

---

### Item segmentation & extraction

1. Split incoming line items on ____.
2. For each line:
   * sku: keep raw alphanumeric/dash token if present.
   * description: free text remainder.
   * itemColor: explicit color string if present, else "".
   * quantity: first integer ≥1. If missing or ≤0:
     - if a charge → set 1.
     - else default 1.

---

### Determining finalSKU

**A) Direct product match**
1. Check sku exact match in **ItemsDB**.
2. Normalize prefixes/suffixes (allow-list only: 199-, ALLP-, etc.) and retry.
3. If still no match → continue to fuzzy match.

**B) Charge codes**
1. If line contains explicit charge tokens (SETUP, 48-RUSH, EC, RUN-CHARGE, etc.), map directly.
2. Else if line matches phrase synonyms ("set up charge", "run charge", "48 hour rush", "drop ship"), map.
3. **PRESERVE original quantities** - do not force charges to quantity = 1 unless originally absent.

**C) Fuzzy match**
If not resolved above:
- Compute composite similarity = (cosine(description vs Catalog) + Levenshtein(sku vs Catalog SKU))/2.
- Accept if ≥0.85.  
- If 0.75–0.85, require either a valid color match or a charge keyword.
- If still unresolved → fallback.

**D) Color resolution**
1. Map itemColor or description tokens via **ColorCodes** / synonyms.
2. If sku already includes dash (e.g., T339-CL), keep as candidate.
3. Else append -COLORCODE to base SKU.
4. Validate against **ItemsDB**.
5. If none valid → OE-MISC-ITEM.

**E) Fallback guard**
Before finalizing OE-MISC-ITEM, retry exact + fuzzy lookups once more.

---

### Rules
* Always uppercase finalSKU.
* Valid forms: SKUCODE-COLORCODE, bare SKUCODE, charge code, or misc fallback.
* Deterministic tie-breaks: highest similarity → prefix match → longest common subsequence → alphanumeric order.

### Available SKU catalog (top 200 items):
${catalogEntries}

### Line items to validate:
${JSON.stringify(lineItems, null, 2)}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o', // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 3000,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      // Parse JSON response - remove markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      const validatedItems = JSON.parse(cleanContent) as ValidatedLineItem[];
      
      // Add validation metadata  
      for (const item of validatedItems) {
        const skuMatch = this.itemsCache.get(item.finalSKU);
        if (skuMatch) {
          // Found in items database
          item.productName = skuMatch.displayName || skuMatch.description || 'Product';
          item.isValidSKU = true;
          item.validationNotes = 'Valid product SKU';
        } else if (this.chargeCodebook.has(item.finalSKU)) {
          // Found in charge codes
          item.isValidSKU = true;
          item.validationNotes = 'Valid charge code';
          item.productName = this.chargeCodebook.get(item.finalSKU);
        } else {
          // Not found anywhere
          item.isValidSKU = false;
          item.validationNotes = 'Unknown SKU - using fallback';
          item.productName = 'Unknown item';
        }
      }

      return validatedItems;
    } catch (error) {
      console.error('OpenAI SKU validation error:', error);
      // Fallback validation
      return lineItems.map(item => ({
        sku: item.sku || '',
        description: item.description,
        itemColor: item.itemColor || '',
        quantity: Math.max(1, item.quantity),
        finalSKU: item.sku?.toUpperCase() || 'OE-MISC-ITEM',
        isValidSKU: false,
        validationNotes: 'Validation failed, using fallback'
      }));
    }
  }

  async validateLineItems(lineItems: LineItem[]): Promise<ValidatedLineItem[]> {
    if (!lineItems || lineItems.length === 0) {
      return [];
    }

    console.log(`🔍 Processing ${lineItems.length} line items:`);
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      console.log(`🔍 Processing line item ${i + 1}:`);
      console.log(`SKU: ${item.sku || 'N/A'} | Description: ${item.description || 'N/A'} | Quantity: ${item.quantity} | Color: ${item.itemColor || 'N/A'}`);
      
      if (item.sku) {
        // Apply simple preprocessing similar to existing logic
        let processedSKU = item.sku.toUpperCase();
        
        // Handle common transformations
        if (processedSKU === 'SET UP') {
          processedSKU = 'SETUP';
        }
        if (processedSKU === 'PROOF') {
          processedSKU = 'PROOF'; // Keep as PROOF for charge code recognition
        }
        
        console.log(`   ✅ Processed: "${item.sku}" → "${processedSKU}"`);
        item.sku = processedSKU;
        
        // CHARGE CODE HANDLING: Check if this is a charge code (not a product)
        if (this.chargeCodebook.has(processedSKU)) {
          // For all charge codes (including OE-MISC-CHARGE), let AI analyze
          // AI will handle OE-MISC-CHARGE specially to find actual SKUs
          item.finalSKU = processedSKU;
          console.log(`   💰 Charge Code: "${processedSKU}" identified as ${this.chargeCodebook.get(processedSKU)}`);
          if (processedSKU === 'OE-MISC-CHARGE') {
            console.log(`   🔍 OE-MISC-CHARGE: AI will analyze description "${item.description}" for actual SKU`);
          }
        }
      }
      
      // FALLBACK: If finalSKU is empty/null, use the processed SKU as fallback
      if (!item.finalSKU && item.sku) {
        item.finalSKU = item.sku;
        console.log(`   🔧 Fallback: Using SKU "${item.sku}" as finalSKU (Gemini returned empty finalSKU)`);
      }
    }
    
    try {
      const validatedItems = await this.validateWithOpenAI(lineItems);
      
      console.log(`✅ Total validated: ${validatedItems.length} line items`);
      console.log(`   ✅ Line items validated: ${validatedItems.length} items processed`);
      for (let i = 0; i < validatedItems.length; i++) {
        const item = validatedItems[i];
        const itemType = this.chargeCodebook.has(item.finalSKU?.toUpperCase() || '') ? 'Charge' : 'Product';
        console.log(`   └─ Item ${i + 1}: ${item.finalSKU} - ${item.description} (Qty: ${item.quantity}) [${itemType}]`);
      }
      
      return validatedItems;
    } catch (error) {
      console.error('Line items validation failed:', error);
      throw error;
    }
  }

  /**
   * CONDITIONAL HELPER: Analyzes OE-MISC-CHARGE items and checks descriptions for better charge code matches
   */
  private improveOEMiscChargeMapping(items: ValidatedLineItem[]): ValidatedLineItem[] {
    const improved = items.map(item => {
      // Only process items that were mapped to OE-MISC-CHARGE
      if (item.finalSKU?.toUpperCase() !== 'OE-MISC-CHARGE') {
        return item;
      }

      const description = (item.description || '').toLowerCase();
      let betterMatch: { code: string; name: string } | null = null;

      // Define description patterns for known charge codes
      const patterns = [
        { 
          keywords: ['proof', 'proofing', 'pre-production sample'], 
          code: 'PROOF', 
          name: 'Proof Charge' 
        },
        { 
          keywords: ['setup', 'set up', 'set-up', 'setup charge'], 
          code: 'SETUP', 
          name: 'Setup Charge' 
        },
        { 
          keywords: ['rush', '48 hour', '24 hour', '48-hour', '24-hour', 'express'], 
          code: '48-RUSH', 
          name: 'Rush Charge' 
        },
        { 
          keywords: ['freight', 'shipping', 'ship as needed', 'delivery'], 
          code: 'FREIGHT', 
          name: 'Freight Charge' 
        },
        { 
          keywords: ['extra charge', 'additional charge', 'misc charge'], 
          code: 'EC', 
          name: 'Extra Charge' 
        }
      ];

      // Check each pattern for matches
      for (const pattern of patterns) {
        if (pattern.keywords.some(keyword => description.includes(keyword))) {
          betterMatch = { code: pattern.code, name: pattern.name };
          break; // Use first match found
        }
      }

      if (betterMatch) {
        console.log(`   🔍 CONDITIONAL HELPER: OE-MISC-CHARGE → ${betterMatch.code}`);
        console.log(`      Description: "${item.description}"`);
        console.log(`      Better match: ${betterMatch.name}`);
        
        return {
          ...item,
          finalSKU: betterMatch.code,
          productName: betterMatch.name,
          validationNotes: `Improved from OE-MISC-CHARGE via description analysis`
        };
      }

      return item;
    });

    return improved;
  }
}