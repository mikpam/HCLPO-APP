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

  constructor() {
    this.initializeData();
  }

  private async initializeData() {
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

      console.log(`✅ SKU validator initialized with ${this.normalizedSkus.size} SKUs`);
    } catch (error) {
      console.error('❌ Error initializing SKU validator:', error);
    }
  }

  async validateLineItems(input: string): Promise<ValidatedSKU[]> {
    console.log('🤖 OPENAI SKU VALIDATOR: Processing line items...');

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
    // Prepare a focused prompt for a single line item
    const normalizedSkusArray = Array.from(this.normalizedSkus).slice(0, 30);

    const prompt = `Extract data from this single line item for High Caliber Line (HCL):

Return a JSON object with exactly these fields:
{
  "sku": "extracted SKU or empty string",
  "description": "item description", 
  "itemColor": "color if mentioned or empty string",
  "quantity": number (minimum 1),
  "finalSKU": "validated final SKU"
}

For finalSKU rules:
- If SKU exists in catalog: use it uppercase
- If description contains "setup", "charge", "rush", "proof": use "SETUP", "48-RUSH", "R", "P" etc.
- Otherwise: "OE-MISC-ITEM"

Available SKUs: ${JSON.stringify(normalizedSkusArray.slice(0, 15))}

Line item:
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