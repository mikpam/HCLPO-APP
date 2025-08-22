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
  unitPrice?: number;
  totalPrice?: number;
  imprintColor?: string;
  finalSKU?: string;
}

interface ValidatedLineItem {
  sku: string;
  description: string;
  itemColor: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  imprintColor?: string;
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

    // Initialize charge codebook - expanded with common variations
    this.chargeCodebook.set('SETUP', 'Setup charges');
    this.chargeCodebook.set('48-RUSH', 'Rush charges');
    this.chargeCodebook.set('EC', 'Extra charges');
    this.chargeCodebook.set('P', 'Proof charges');
    this.chargeCodebook.set('PROOF', 'Proof charges');
    this.chargeCodebook.set('FREIGHT', 'Freight charges');
    this.chargeCodebook.set('RUN-CHARGE', 'Run charges');
    this.chargeCodebook.set('LTM', 'Less than minimum charges');
    this.chargeCodebook.set('LESS-THAN-MIN', 'Less than minimum charges');
    this.chargeCodebook.set('MIN-FEE', 'Minimum fee charges');
    this.chargeCodebook.set('OE-MISC-CHARGE', 'Miscellaneous charges');
    this.chargeCodebook.set('OE-MISC-ITEM', 'Unknown products');
  }

  private async findColorVariantFromDB(baseSKU: string, colorName: string): Promise<string | null> {
    if (!colorName) return null;
    
    const colorLower = colorName.toLowerCase().trim();
    
    // Map common color names to color codes
    const colorMappings: { [key: string]: string } = {
      'white': '00',
      'black': '06',
      'blue': '01',
      'royal blue': '01',
      'royal': '01',
      'red': '02',
      'green': '03',
      'orange': '04',
      'purple': '05',
      'yellow': '08',
      'navy': '10',
      'navy blue': '10',
      'clear': 'CL',
      'gray': '07',
      'grey': '07',
      'pink': '09',
      'brown': '11',
      'lime': '12',
      'lime green': '12',
      'teal': '13',
      'silver': '14',
      'gold': '15',
      'maroon': '16',
      'forest green': '17',
      'kelly green': '18',
      'light blue': '19',
      'aqua': '20'
    };
    
    // Try to find a matching color code
    let colorCode: string | null = null;
    for (const [colorKey, code] of Object.entries(colorMappings)) {
      if (colorLower.includes(colorKey)) {
        colorCode = code;
        break;
      }
    }
    
    if (colorCode) {
      // Check if this variant exists in the database
      const variantSKU = `${baseSKU}-${colorCode}`;
      try {
        const dbResult = await db.select().from(items)
          .where(sql`UPPER(final_sku) = ${variantSKU.toUpperCase()} AND is_active = true`)
          .limit(1);
        
        if (dbResult.length > 0) {
          console.log(`   🎨 Color variant found in DB: ${colorName} → ${colorCode} → ${variantSKU}`);
          // Add to cache for future use
          this.itemsCache.set(variantSKU, dbResult[0]);
          return variantSKU;
        }
      } catch (error) {
        console.log(`   ⚠️ DB lookup failed for variant ${variantSKU}`);
      }
    }
    
    // Try fuzzy search for color in description/display name
    try {
      const dbResult = await db.select().from(items)
        .where(sql`
          UPPER(final_sku) LIKE ${baseSKU.toUpperCase() + '-%'} 
          AND is_active = true
          AND (LOWER(display_name) LIKE ${'%' + colorLower + '%'} 
               OR LOWER(description) LIKE ${'%' + colorLower + '%'})
        `)
        .limit(1);
      
      if (dbResult.length > 0) {
        const variantSKU = dbResult[0].finalSku;
        console.log(`   🎨 Color variant found (fuzzy match): ${colorName} → ${variantSKU}`);
        // Add to cache for future use
        this.itemsCache.set(variantSKU, dbResult[0]);
        return variantSKU;
      }
    } catch (error) {
      console.log(`   ⚠️ DB fuzzy search failed for ${baseSKU} with color ${colorName}`);
    }
    
    console.log(`   ⚠️ No variant found for ${baseSKU} in color ${colorName}`);
    return null;
  }

  private findColorVariant(baseSKU: string, colorName: string): string | null {
    if (!colorName) return null;
    
    const colorLower = colorName.toLowerCase().trim();
    
    // Map common color names to color codes
    const colorMappings: { [key: string]: string } = {
      'white': '00',
      'black': '06',
      'blue': '01',
      'royal blue': '01',
      'royal': '01',
      'red': '02',
      'green': '03',
      'orange': '04',
      'purple': '05',
      'yellow': '08',
      'navy': '10',
      'navy blue': '10',
      'clear': 'CL',
      'gray': '07',
      'grey': '07',
      'pink': '09',
      'brown': '11',
      'lime': '12',
      'lime green': '12',
      'teal': '13',
      'silver': '14',
      'gold': '15',
      'maroon': '16',
      'forest green': '17',
      'kelly green': '18',
      'light blue': '19',
      'aqua': '20'
    };
    
    // Try to find a matching color code
    let colorCode: string | null = null;
    for (const [colorKey, code] of Object.entries(colorMappings)) {
      if (colorLower.includes(colorKey)) {
        colorCode = code;
        break;
      }
    }
    
    if (!colorCode) {
      console.log(`   ⚠️ No color mapping found for: ${colorName}`);
      return null;
    }
    
    // Check if this variant exists in the cache
    const variantSKU = `${baseSKU}-${colorCode}`;
    const variantMatch = this.itemsCache.get(variantSKU);
    
    if (variantMatch) {
      console.log(`   🎨 Color variant found: ${colorName} → ${colorCode} → ${variantSKU}`);
      return variantSKU;
    }
    
    // Try alternate formats (like T811-FD for special variants)
    // Since LRUCache doesn't have entries(), we'll check common variant formats
    const commonVariants = ['FD', 'SP', 'LT', 'DK', 'MT'];
    for (const variant of commonVariants) {
      const variantSKU = `${baseSKU}-${variant}`;
      const variantMatch = this.itemsCache.get(variantSKU);
      if (variantMatch && 
          (variantMatch.displayName?.toLowerCase().includes(colorLower) || 
           variantMatch.description?.toLowerCase().includes(colorLower))) {
        console.log(`   🎨 Color variant found (special variant): ${colorName} → ${variantSKU}`);
        return variantSKU;
      }
    }
    
    console.log(`   ⚠️ No variant found for ${baseSKU} in color ${colorName}`);
    return null;
  }

  private analyzeChargeDescription(description: string, quantity?: number): string | null {
    const descLower = description.toLowerCase();
    
    // QUANTITY-AWARE LOGIC: High quantities (>50) are likely products, not charges
    // Even if they mention charge words, they should be treated as OE-MISC-ITEM
    const isHighQuantity = (quantity || 0) > 50;
    
    if (isHighQuantity) {
      console.log(`   📊 High quantity (${quantity}) detected - treating as product, not charge`);
      return null; // Let it fall through to product logic
    }
    
    // Check for specific charge patterns that should be converted to known charge codes
    if (descLower.includes('less') && descLower.includes('minimum')) return 'LTM';
    if (descLower.includes('ltm fee')) return 'LTM';
    if (descLower.includes('setup') || descLower.includes('set up')) return 'SETUP';
    if (descLower.includes('run charge')) return 'RUN-CHARGE';
    if (descLower.includes('rush') && (descLower.includes('48') || descLower.includes('hour'))) return '48-RUSH';
    if (descLower.includes('freight')) return 'FREIGHT';
    if (descLower.includes('proof')) return 'PROOF';
    
    // For shipping, PMS match, and other unidentifiable charges, keep OE-MISC-CHARGE
    // This is a valid finalSKU in the items database for unsolvable charge items
    if (descLower.includes('shipping') || descLower.includes('s & h') || 
        descLower.includes('pms match') || descLower.includes('handling')) {
      return 'OE-MISC-CHARGE';
    }
    
    return null;
  }

  private async vectorSearchItem(item: LineItem): Promise<ValidatedLineItem | null> {
    try {
      // Build query text including all available item details
      const queryParts = [
        item.sku,
        item.description,
        item.itemColor,
        item.imprintColor
      ].filter(Boolean);
      
      const queryText = queryParts.join(' ');
      if (!queryText) return null;
      
      // Generate embedding
      const embeddingResponse = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: queryText
      });
      
      const queryEmbedding = embeddingResponse.data[0].embedding;
      
      // Search for similar items
      const vectorMatches = await db.execute(sql`
        WITH params AS (
          SELECT CAST(${JSON.stringify(queryEmbedding)}::text AS vector(1536)) AS q
        )
        SELECT
          i.final_sku, i.display_name, i.description,
          1 - (i.item_embedding <=> p.q) AS cosine_sim
        FROM items i, params p
        WHERE i.item_embedding IS NOT NULL
          AND i.is_active = true
          AND (1 - (i.item_embedding <=> p.q)) > 0.75
        ORDER BY i.item_embedding <=> p.q
        LIMIT 3
      `);
      
      if (vectorMatches.rows.length > 0) {
        // Find the best match, preferring exact base SKU matches
        let bestMatch = vectorMatches.rows[0];
        
        // If we have multiple matches, prefer one that matches the base SKU
        if (item.sku && vectorMatches.rows.length > 1) {
          const baseSKU = item.sku.toUpperCase().split('-')[0];
          for (const row of vectorMatches.rows) {
            const matchBaseSKU = (row.final_sku as string).split('-')[0];
            if (matchBaseSKU === baseSKU) {
              bestMatch = row;
              break;
            }
          }
        }
        
        // Check if we need to apply color variant to the matched SKU
        if (item.itemColor && bestMatch) {
          const baseSKU = (bestMatch.final_sku as string).split('-')[0];
          const colorVariantSKU = this.findColorVariant(baseSKU, item.itemColor);
          if (colorVariantSKU) {
            console.log(`   ✅ VECTOR MATCH + COLOR: ${item.sku} → ${baseSKU} + ${item.itemColor} → ${colorVariantSKU}`);
            return {
              sku: item.sku || '',
              description: item.description || bestMatch.description as string || '',
              itemColor: item.itemColor || '',
              quantity: item.quantity || 1,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              imprintColor: item.imprintColor,
              finalSKU: colorVariantSKU,
              productName: bestMatch.display_name as string,
              isValidSKU: true,
              validationNotes: `Vector match with color variant (${(parseFloat(bestMatch.cosine_sim as string) * 100).toFixed(1)}% similarity)`
            };
          }
        }
        
        console.log(`   ✅ VECTOR MATCH: ${item.sku} → ${bestMatch.final_sku} (similarity: ${bestMatch.cosine_sim})`);
        return {
          sku: item.sku || '',
          description: item.description || bestMatch.description as string || '',
          itemColor: item.itemColor || '',
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          imprintColor: item.imprintColor,
          finalSKU: bestMatch.final_sku as string,
          productName: bestMatch.display_name as string,
          isValidSKU: true,
          validationNotes: `Vector match (${(parseFloat(bestMatch.cosine_sim as string) * 100).toFixed(1)}% similarity)`
        };
      }
      
      return null;
    } catch (error) {
      console.error('Vector search failed for item:', error);
      return null;
    }
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
* quantity    (integer; **copy exactly from the input line at the same index**)
* finalSKU    (string; uppercase; strictly formatted)

No markdown, no comments, no trailing text.

### Non-negotiable invariants

1. **1:1 index mapping**: For input array index \`i\`, output exactly one object at index \`i\`. **No reordering, merging, or splitting.**
2. **Quantity lock**: \`output[i].quantity = input[i].quantity\` exactly.
   * Never normalize, round, or move quantities.
   * Never force charges to \`1\`.
   * If quantity is missing in the input only, default to \`1\`.
3. **Do not re-segment**: The input array is pre-segmented line items.

---

### System resources (available)

* **ItemsDB**: PostgreSQL table with all valid HCL SKUs and variants (base + color codes).
* **Item Embeddings**: Vector search available for semantic product matching.
* **ColorCodes**: canonical map (${colorCodesContext}).
* **ChargeCodebook**: explicit charge codes (${chargeCodesContext}) with phrase synonyms.
* **Fallbacks**: \`OE-MISC-ITEM\` (unknown product), \`OE-MISC-CHARGE\` (ambiguous charge).

### Validation flow (per line item \`i\`)

**A. Copy-through fields**
* Set \`sku\`, \`description\`, \`itemColor\`, \`quantity\` from \`input[i]\` **verbatim**.
* \`quantity\` must match input exactly.

**B. Direct SKU check**
1. If \`sku\` equals an existing product SKU (case-insensitive), use it as base.
2. Try normalized versions (remove prefixes like \`199-\`, \`ALLP-\`).
3. If still no match, proceed to semantic search.

**C. Semantic product search**
1. Build query from: SKU token + description + color words
2. Use vector similarity search for products
3. Accept top candidate if:
   * **score ≥ 0.85** → accept
   * **0.75 ≤ score < 0.85** → accept only with valid color match
   * Otherwise continue to charge detection

**D. Charge detection (preserve quantity)**
* Map charge patterns deterministically:
  * "Set Up/Setup" → \`SETUP\`
  * "Run Charge/Extra Color/EC" → \`RUN-CHARGE\`
  * "48 hour rush" → \`48-RUSH\`
  * "Drop ship" → \`DROP-SHIP\`
  * "PMS match" → \`OE-MISC-CHARGE\`
* **Never modify quantity for charges**

**E. Color resolution**
1. Normalize color via ColorCodes
2. If base SKU has dash variant, validate it
3. Else compose \`BASESKU-COLORCODE\` and validate
4. If no valid variant, keep bare base

**F. Fallback**
* Charge-like but ambiguous → \`OE-MISC-CHARGE\`
* Otherwise → \`OE-MISC-ITEM\`

### Critical: Quantity Examples
* "Run Charge" (qty **130**) → \`RUN-CHARGE\` (qty **130**)
* "Setup Charge" (qty **4**) → \`SETUP\` (qty **4**)
* "Product SKU" (qty **250**) → Product finalSKU (qty **250**)

### Available SKU catalog:
${catalogEntries}

### Line items to validate (already segmented; do not re-segment):
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
      
      // ENFORCE 1:1 INDEX MAPPING AND QUANTITY LOCK
      // The new prompt enforces these constraints, but we double-check here
      const correctedItems: ValidatedLineItem[] = [];
      
      // Validate AI response structure
      if (validatedItems.length !== lineItems.length) {
        console.warn(`   ⚠️ AI VIOLATION: Expected ${lineItems.length} items, got ${validatedItems.length}. Creating fallbacks.`);
      }
      
      for (let i = 0; i < lineItems.length; i++) {
        const original = lineItems[i];
        const validated = validatedItems[i]; // Strict index-based matching
        
        if (validated) {
          // ENFORCE INVARIANTS: Copy original data exactly, only trust finalSKU from AI
          const correctedItem = {
            sku: original.sku || '',                    // LOCK: Use original
            description: original.description,          // LOCK: Use original  
            itemColor: original.itemColor || '',        // LOCK: Use original
            quantity: original.quantity,                // LOCK: Use original quantity
            unitPrice: original.unitPrice,              // LOCK: Use original
            totalPrice: original.totalPrice,            // LOCK: Use original
            imprintColor: original.imprintColor,        // LOCK: Use original
            finalSKU: validated.finalSKU?.toUpperCase() || 'OE-MISC-ITEM', // Only trust finalSKU from AI
            isValidSKU: false,                          // Will be set below
            validationNotes: 'AI validation'
          };
          
          // Business logic validation: Detect obvious swaps and correct them
          if (this.chargeCodebook.has(correctedItem.finalSKU) && correctedItem.quantity > 10) {
            console.warn(`   🚨 BUSINESS RULE VIOLATION: Charge code ${correctedItem.finalSKU} assigned qty ${correctedItem.quantity} - auto-correcting`);
            
            // Force use original SKU for high quantities
            if (original.sku && !this.chargeCodebook.has(original.sku.toUpperCase())) {
              correctedItem.finalSKU = original.sku.toUpperCase();
              console.log(`   🔧 AUTO-CORRECTED: High qty item uses original SKU ${original.sku}`);
            } else {
              correctedItem.finalSKU = 'OE-MISC-ITEM';
              console.log(`   🔧 AUTO-CORRECTED: High qty unknown item fallback`);
            }
          }
          
          // Check for setup/charge patterns in low quantity items
          if (correctedItem.quantity === 1) {
            const desc = original.description.toLowerCase();
            if (desc.includes('setup') && !desc.includes('proof')) {
              correctedItem.finalSKU = 'SETUP';
              console.log(`   🔧 PATTERN MATCH: Setup description → SETUP charge code`);
            } else if (desc.includes('proof')) {
              correctedItem.finalSKU = 'PROOF';
              console.log(`   🔧 PATTERN MATCH: Proof description → PROOF charge code`);
            }
          }
          
          correctedItems.push(correctedItem);
        } else {
          // AI returned fewer items - create strict fallback
          console.warn(`   ⚠️ AI MISSING ITEM: Creating fallback for index ${i}`);
          correctedItems.push({
            sku: original.sku || '',
            description: original.description,
            itemColor: original.itemColor || '',
            quantity: original.quantity,                // PRESERVE exact quantity
            unitPrice: original.unitPrice,
            totalPrice: original.totalPrice,
            imprintColor: original.imprintColor,
            finalSKU: original.sku?.toUpperCase() || 'OE-MISC-ITEM',
            isValidSKU: false,
            validationNotes: 'Fallback - AI response incomplete'
          });
        }
      }
      
      // Final validation: Ensure we have exactly the right number of items
      if (correctedItems.length !== lineItems.length) {
        throw new Error(`Index mapping violation: Expected ${lineItems.length} items, created ${correctedItems.length}`);
      }
      
      // Replace the validated items with the correctly matched ones
      validatedItems.length = 0;
      validatedItems.push(...correctedItems);
      
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
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        imprintColor: item.imprintColor,
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
    
    // 🔐 QUANTITY LOCK: Normalize input but preserve quantities and order
    const normalizedInput = lineItems.map((item, index) => {
      console.log(`🔍 Processing line item ${index + 1}:`);
      console.log(`SKU: ${item.sku || 'N/A'} | Description: ${item.description || 'N/A'} | Quantity: ${item.quantity} | Color: ${item.itemColor || 'N/A'}`);
      
      let processedSKU = (item.sku || "").trim().toUpperCase();
      
      // Handle common transformations
      if (processedSKU === 'SET UP') {
        processedSKU = 'SETUP';
      }
      if (processedSKU === 'PROOF') {
        processedSKU = 'PROOF';
      }
      
      if (processedSKU) {
        console.log(`   ✅ Processed: "${item.sku}" → "${processedSKU}"`);
      }
      
      return {
        sku: processedSKU,
        description: (item.description || "").trim(),
        itemColor: (item.itemColor || "").trim(),
        quantity: Number.isFinite(item.quantity) ? item.quantity : 1, // Lock quantity from input
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        imprintColor: item.imprintColor,
        finalSKU: (item.finalSKU || "").trim().toUpperCase()
      };
    });

    // 🔐 SWAP DETECTOR: Create signature before processing
    const sigBefore = normalizedInput.map((r, i) => `${i}:${r.sku}|${r.quantity}`).join("||");
    
    // Load cache for DB lookup
    await this.loadItemsCache();
    
    // HYBRID APPROACH: Check DB first, then resolve finalSKUs only
    const finalSKUs: string[] = [];
    const needsAIValidation: number[] = [];
    
    for (let i = 0; i < normalizedInput.length; i++) {
      const item = normalizedInput[i];
      
      // CHARGE CODE DETECTION: Handle known charge codes first
      if (this.chargeCodebook.has(item.sku)) {
        finalSKUs[i] = item.sku;
        console.log(`   💰 Charge Code: "${item.sku}" identified as ${this.chargeCodebook.get(item.sku)}`);
        continue;
      }
      
      // OE-MISC-CHARGE analysis
      if (item.sku === 'OE-MISC-CHARGE' || item.finalSKU === 'OE-MISC-CHARGE') {
        const chargeType = this.analyzeChargeDescription(item.description, item.quantity);
        if (chargeType) {
          finalSKUs[i] = chargeType;
          console.log(`   💡 OE-MISC-CHARGE analyzed: "${item.description}" (qty: ${item.quantity}) → ${chargeType}`);
        } else {
          // High quantities should become OE-MISC-ITEM (products), not charges
          const fallbackSKU = (item.quantity || 0) > 50 ? 'OE-MISC-ITEM' : 'OE-MISC-CHARGE';
          finalSKUs[i] = fallbackSKU;
          console.log(`   💡 OE-MISC-CHARGE fallback: "${item.description}" (qty: ${item.quantity}) → ${fallbackSKU}`);
        }
        continue;
      }
      
      // Check if SKU directly exists in items cache
      let exactMatch = this.itemsCache.get(item.sku.toUpperCase());
      
      // If not in cache, do a direct database lookup
      if (!exactMatch && item.sku) {
        try {
          const dbResult = await db.select().from(items)
            .where(sql`UPPER(final_sku) = ${item.sku.toUpperCase()} AND is_active = true`)
            .limit(1);
          
          if (dbResult.length > 0) {
            exactMatch = dbResult[0];
            // Add to cache for future use
            this.itemsCache.set(item.sku.toUpperCase(), exactMatch);
            console.log(`   📦 DB LOOKUP: Found ${item.sku} in database`);
          }
        } catch (error) {
          console.log(`   ⚠️ DB lookup failed for ${item.sku}`);
        }
      }
      
      if (exactMatch) {
        // Check if we need to apply color variant
        if (item.itemColor) {
          const colorVariantSKU = await this.findColorVariantFromDB(item.sku, item.itemColor);
          if (colorVariantSKU) {
            finalSKUs[i] = colorVariantSKU;
            console.log(`   ✅ EXACT MATCH WITH COLOR: ${item.sku} + ${item.itemColor} → ${colorVariantSKU}`);
            continue;
          }
        }
        finalSKUs[i] = exactMatch.finalSku;
        console.log(`   ✅ EXACT MATCH: ${item.sku} → ${exactMatch.finalSku}`);
        continue;
      }
      
      // Check if it's a base SKU that exists (without color code)
      // For example: T811 exists, even if T811-01 doesn't
      const baseSKU = item.sku.toUpperCase().split('-')[0];
      let baseMatch = this.itemsCache.get(baseSKU);
      
      // If not in cache, do a direct database lookup for base SKU
      if (!baseMatch && baseSKU) {
        try {
          const dbResult = await db.select().from(items)
            .where(sql`UPPER(final_sku) = ${baseSKU} AND is_active = true`)
            .limit(1);
          
          if (dbResult.length > 0) {
            baseMatch = dbResult[0];
            // Add to cache for future use
            this.itemsCache.set(baseSKU, baseMatch);
            console.log(`   📦 DB LOOKUP: Found base SKU ${baseSKU} in database`);
          }
        } catch (error) {
          console.log(`   ⚠️ DB lookup failed for base SKU ${baseSKU}`);
        }
      }
      
      if (baseMatch) {
        // Found base SKU, try to find color variant
        if (item.itemColor) {
          const colorVariantSKU = await this.findColorVariantFromDB(baseSKU, item.itemColor);
          if (colorVariantSKU) {
            finalSKUs[i] = colorVariantSKU;
            console.log(`   ✅ BASE SKU + COLOR: ${baseSKU} + ${item.itemColor} → ${colorVariantSKU}`);
            continue;
          }
        }
        // Use base SKU if no color variant found
        finalSKUs[i] = baseMatch.finalSku;
        console.log(`   ✅ BASE SKU MATCH: ${item.sku} → ${baseMatch.finalSku}`);
        continue;
      }
      
      // Try vector search if available
      try {
        const vectorResult = await this.vectorSearchItem(item);
        
        if (vectorResult) {
          finalSKUs[i] = vectorResult.finalSKU;
          console.log(`   ✅ VECTOR MATCH: ${item.sku} → ${vectorResult.finalSKU}`);
          continue;
        }
      } catch (error) {
        // Vector search failed, will fall back to AI
        console.log(`   ⚠️ Vector search failed for ${item.sku}, will use AI`);
      }
      
      // Add to AI validation queue (store index for proper reconstruction)
      needsAIValidation.push(i);
    }
    
    // AI Validation for remaining items (only finalSKUs, no quantities)
    if (needsAIValidation.length > 0) {
      console.log(`   🤖 ${needsAIValidation.length} items need AI validation...`);
      
      // Create projection for AI (include quantities for quantity-aware decisions!)
      const projection = needsAIValidation.map(index => ({
        i: index,
        sku: normalizedInput[index].sku,
        description: normalizedInput[index].description,
        itemColor: normalizedInput[index].itemColor,
        quantity: normalizedInput[index].quantity
      }));
      
      try {
        const aiFinalSKUs = await this.resolveFinalSKUsWithAI(projection);
        
        // Assign AI results back to correct indices
        for (let j = 0; j < needsAIValidation.length; j++) {
          const originalIndex = needsAIValidation[j];
          finalSKUs[originalIndex] = aiFinalSKUs[j] || 'OE-MISC-ITEM';
        }
      } catch (error) {
        console.error('AI validation failed:', error);
        // Fallback for remaining items
        for (const index of needsAIValidation) {
          finalSKUs[index] = normalizedInput[index].sku || 'OE-MISC-ITEM';
        }
      }
    }
    
    console.log(`✅ Total validated: ${normalizedInput.length} line items`);
    
    // 🔐 RECONSTRUCT: Build final output strictly by index, quantities from input only
    const result: ValidatedLineItem[] = normalizedInput.map((src, i) => ({
      sku: src.sku,
      description: src.description,
      itemColor: src.itemColor,
      quantity: src.quantity, // AUTHORITATIVE: never from model
      unitPrice: src.unitPrice,
      totalPrice: src.totalPrice,
      imprintColor: src.imprintColor,
      finalSKU: finalSKUs[i] || src.sku || 'OE-MISC-ITEM'
    }));
    
    // 🔐 SWAP DETECTOR: Verify no quantity swapping occurred
    const sigAfter = result.map((r, i) => `${i}:${r.sku}|${r.quantity}`).join("||");
    if (sigBefore !== sigAfter) {
      console.warn("⚠️ SWAP DETECTED", { sigBefore, sigAfter });
    }
    
    // Guards: Ensure array integrity
    if (result.length !== normalizedInput.length) {
      throw new Error(`Row count changed: input ${normalizedInput.length}, output ${result.length}`);
    }
    
    for (let i = 0; i < result.length; i++) {
      if (result[i].quantity !== normalizedInput[i].quantity) {
        throw new Error(`Quantity drift at index ${i}: input ${normalizedInput[i].quantity}, output ${result[i].quantity}`);
      }
    }
    
    // Add validation metadata
    for (const item of result) {
      const skuMatch = this.itemsCache.get(item.finalSKU);
      if (skuMatch) {
        // Found in items database
        item.productName = skuMatch.displayName || skuMatch.description || 'Product';
        item.isValidSKU = true;
        item.validationNotes = 'Valid product SKU';
      } else if (this.chargeCodebook.has(item.finalSKU)) {
        // Found in charge codes
        item.isValidSKU = true;
        item.validationNotes = this.chargeCodebook.get(item.finalSKU) || 'Valid charge code';
        item.productName = this.chargeCodebook.get(item.finalSKU);
      } else {
        // Not found anywhere
        item.isValidSKU = false;
        item.validationNotes = 'Unknown SKU - using fallback';
        item.productName = 'Unknown item';
      }
    }

    // Log validation results for debugging
    console.log(`   ✅ Line items validated: ${result.length} items processed`);
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      const itemType = this.chargeCodebook.has(item.finalSKU?.toUpperCase() || '') ? 'Charge' : 'Product';
      console.log(`   └─ Item ${i + 1}: ${item.finalSKU} - ${item.description} (Qty: ${item.quantity}) [${itemType}]`);
    }
    
    console.log(`   ✅ SKU validation complete: ${result.length} items processed`);
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      console.log(`      ${i + 1}. "${item.sku}" → "${item.finalSKU}"`);
    }

    return result;
  }

  // Helper method: AI validation that returns only finalSKUs array
  private async resolveFinalSKUsWithAI(projection: Array<{i: number, sku: string, description: string, itemColor: string, quantity: number}>): Promise<string[]> {
    // Create color codes context
    const colorCodesContext = Array.from(this.colorCodes.entries()).map(([code, name]) =>
      `${code}: ${name}`
    ).join(', ');

    // Create charge codes context  
    const chargeCodesContext = Array.from(this.chargeCodebook.entries()).map(([code, desc]) =>
      `${code}: ${desc}`
    ).join(', ');

    const prompt = `You are a SKU resolver for High Caliber Line (HCL).

Return **only** a JSON array of strings, where each element is the finalSKU for the line at the same index as the input array.

### Rules:
1. Do not include any other fields except finalSKU strings
2. Do not reorder, merge, or split the input
3. Return exactly ${projection.length} strings in the same order
4. Each string should be a valid SKU format (uppercase, properly formatted)

### CRITICAL QUANTITY LOGIC:
* HIGH QUANTITIES (>50): Always treat as PRODUCTS → use OE-MISC-ITEM, never charge codes
* LOW QUANTITIES (≤50): Can be charges if description matches charge patterns
* Examples:
  - "Run Charge" (qty 200) → "OE-MISC-ITEM" (product)
  - "Setup Charge" (qty 1) → "SETUP" (charge)
  - "Rush Charge" (qty 100) → "OE-MISC-ITEM" (product)

### Available Resources:
* ColorCodes: ${colorCodesContext}
* ChargeCodes: ${chargeCodesContext}
* Fallbacks: OE-MISC-ITEM (unknown product), OE-MISC-CHARGE (unknown charge)

### Input to resolve:
${JSON.stringify(projection.map(p => ({ sku: p.sku, description: p.description, itemColor: p.itemColor, quantity: p.quantity })), null, 2)}

Return only the JSON array of finalSKU strings.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 1000,
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
    
    const finalSKUs = JSON.parse(cleanContent) as string[];
    
    if (!Array.isArray(finalSKUs) || finalSKUs.length !== projection.length) {
      throw new Error(`AI returned invalid array: expected ${projection.length} items, got ${finalSKUs?.length || 0}`);
    }

    return finalSKUs.map(sku => (sku || 'OE-MISC-ITEM').toUpperCase().trim());
  }

  /**
   * QUANTITY-BASED GUARDRAIL: Ensures charge codes have lower quantities than products
   * This prevents the common issue where SETUP (qty 1) gets swapped with product SKUs (qty 100+)
   */
  private applyQuantityGuardrail(items: ValidatedLineItem[]): ValidatedLineItem[] {
    if (items.length < 2) return items;
    
    // Identify charge codes and products
    const chargeItems = items.filter(item => 
      this.chargeCodebook.has(item.finalSKU?.toUpperCase() || '')
    );
    const productItems = items.filter(item => 
      !this.chargeCodebook.has(item.finalSKU?.toUpperCase() || '')
    );
    
    // If we have both charges and products, check for misalignment
    if (chargeItems.length > 0 && productItems.length > 0) {
      const maxChargeQty = Math.max(...chargeItems.map(c => c.quantity || 0));
      const minProductQty = Math.min(...productItems.map(p => p.quantity || 0));
      
      // If a charge has higher quantity than a product, they're likely swapped
      if (maxChargeQty > minProductQty && maxChargeQty > 10) {
        console.log(`   ⚠️ QUANTITY GUARDRAIL: Detected potential SKU swap (charge qty ${maxChargeQty} > product qty ${minProductQty})`);
        
        // Find the misaligned pairs
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const isCharge = this.chargeCodebook.has(item.finalSKU?.toUpperCase() || '');
          
          // If this is a charge with high quantity
          if (isCharge && (item.quantity || 0) > 10) {
            // Find a product with low quantity (likely the swapped one)
            for (let j = 0; j < items.length; j++) {
              if (i === j) continue;
              const otherItem = items[j];
              const otherIsProduct = !this.chargeCodebook.has(otherItem.finalSKU?.toUpperCase() || '');
              
              // If we found a product with low quantity, they're likely swapped
              if (otherIsProduct && (otherItem.quantity || 0) <= 10) {
                console.log(`   🔄 SWAPPING: ${item.finalSKU} (qty ${item.quantity}) ↔ ${otherItem.finalSKU} (qty ${otherItem.quantity})`);
                
                // Swap the finalSKUs to correct the misalignment
                const tempSKU = item.finalSKU;
                const tempName = item.productName;
                const tempValid = item.isValidSKU;
                const tempNotes = item.validationNotes;
                
                item.finalSKU = otherItem.finalSKU;
                item.productName = otherItem.productName;
                item.isValidSKU = otherItem.isValidSKU;
                item.validationNotes = 'Corrected via quantity guardrail';
                
                otherItem.finalSKU = tempSKU;
                otherItem.productName = tempName;
                otherItem.isValidSKU = tempValid;
                otherItem.validationNotes = 'Corrected via quantity guardrail';
                
                break; // Only swap once per charge
              }
            }
          }
        }
      }
    }
    
    return items;
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