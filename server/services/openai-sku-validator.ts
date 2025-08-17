import OpenAI from 'openai';
import { db } from '../db';
import { items } from '@shared/schema';
import { sql } from 'drizzle-orm';

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
  private itemsCache: Map<string, any> = new Map();
  private catalogMap: Map<string, string> = new Map();
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
    this.chargeCodebook.set('OE-MISC-CHARGE', 'Miscellaneous charges');
    this.chargeCodebook.set('OE-MISC-ITEM', 'Unknown products');
  }

  private async loadItemsCache(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCacheUpdate < this.CACHE_TTL && this.itemsCache.size > 0) {
      return; // Cache is still valid
    }

    try {
      const allItems = await db.select().from(items).where(sql`is_active = true`);
      
      this.itemsCache.clear();
      this.catalogMap.clear();
      
      for (const item of allItems) {
        this.itemsCache.set(item.finalSku.toUpperCase(), item);
        this.catalogMap.set(item.finalSku.toUpperCase(), item.displayName || item.description || 'No description');
      }
      
      this.lastCacheUpdate = now;
      console.log(`   📦 Loaded ${this.itemsCache.size} items into cache`);
    } catch (error) {
      console.error('Failed to load items cache:', error);
    }
  }

  private async validateWithOpenAI(lineItems: LineItem[]): Promise<ValidatedLineItem[]> {
    await this.loadItemsCache();
    
    // Create a catalog for OpenAI context (top 200 items for better context)
    const catalogEntries = Array.from(this.catalogMap.entries()).slice(0, 200).map(([sku, productName]) => 
      `${sku}: ${productName}`
    ).join('\n');

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
1. If line contains explicit charge tokens (SETUP, 48-RUSH, EC, etc.), map directly.
2. Else if line matches phrase synonyms ("set up charge", "48 hour rush", "drop ship"), map.
3. For charges, force quantity = 1 if absent.

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

      // Parse JSON response
      const validatedItems = JSON.parse(content) as ValidatedLineItem[];
      
      // Add validation metadata
      for (const item of validatedItems) {
        const skuMatch = this.itemsCache.get(item.finalSKU);
        if (skuMatch) {
          item.productName = skuMatch.displayName;
          item.isValidSKU = true;
        } else {
          item.isValidSKU = this.chargeCodebook.has(item.finalSKU);
          if (item.isValidSKU) {
            item.validationNotes = 'Charge code';
            item.productName = this.chargeCodebook.get(item.finalSKU);
          } else {
            item.validationNotes = 'Unknown SKU - using fallback';
            item.productName = 'Unknown item';
          }
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
        } else if (processedSKU === 'OE-MISC-CHARGE') {
          processedSKU = 'P'; // Convert to proof charge as seen in logs
        }
        
        console.log(`   ✅ Processed: "${item.sku}" → "${processedSKU}"`);
        item.sku = processedSKU;
      }
    }
    
    try {
      const validatedItems = await this.validateWithOpenAI(lineItems);
      
      console.log(`✅ Total validated: ${validatedItems.length} line items`);
      console.log(`   ✅ Line items validated: ${validatedItems.length} items processed`);
      for (let i = 0; i < validatedItems.length; i++) {
        const item = validatedItems[i];
        console.log(`   └─ Item ${i + 1}: ${item.finalSKU} - ${item.description} (Qty: ${item.quantity})`);
      }
      
      return validatedItems;
    } catch (error) {
      console.error('Line items validation failed:', error);
      throw error;
    }
  }
}