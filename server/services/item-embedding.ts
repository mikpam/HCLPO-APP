import OpenAI from 'openai';
import { db } from '../db.js';
import { items } from '@shared/schema';
import { eq, sql, isNull, and, isNotNull } from 'drizzle-orm';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class ItemEmbeddingService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY 
    });
  }

  /**
   * Generate item text for embedding from item data
   * Format: "{sku} | {displayName} | {description} | {subType} | {vendor}/{manufacturer} | {attributes}"
   */
  private generateItemText(item: any): string {
    const parts = [];

    // Primary identifiers
    if (item.sku || item.final_sku) {
      parts.push(item.sku || item.final_sku);
    }
    
    // Names and descriptions
    if (item.display_name) {
      parts.push(item.display_name);
    }
    
    if (item.description) {
      parts.push(item.description);
    }

    // Category and classification
    if (item.sub_type) {
      parts.push(item.sub_type);
    }

    // Vendor and manufacturer info
    const vendorInfo = [];
    if (item.vendor) vendorInfo.push(item.vendor);
    if (item.manufacturer && item.manufacturer !== item.vendor) {
      vendorInfo.push(item.manufacturer);
    }
    if (vendorInfo.length > 0) {
      parts.push(vendorInfo.join('/'));
    }

    // Additional identifiers
    if (item.upc) {
      parts.push(`UPC:${item.upc}`);
    }
    if (item.mpn) {
      parts.push(`MPN:${item.mpn}`);
    }

    // Attributes (color, size, material, etc.)
    if (item.attributes && typeof item.attributes === 'object') {
      const attrParts = [];
      for (const [key, value] of Object.entries(item.attributes)) {
        if (Array.isArray(value)) {
          attrParts.push(`${key}:${value.join(',')}`);
        } else if (value) {
          attrParts.push(`${key}:${value}`);
        }
      }
      if (attrParts.length > 0) {
        parts.push(attrParts.join(' '));
      }
    }

    return parts.filter(Boolean).join(' | ');
  }

  /**
   * Generate embedding for a single item text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float',
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding: ${(error as Error).message}`);
    }
  }

  /**
   * Update item with embedding and text
   */
  async updateItemEmbedding(itemId: string, itemData: any): Promise<void> {
    try {
      const itemText = this.generateItemText(itemData);
      console.log(`📝 Generated item text for ${itemData.sku || itemData.final_sku}: ${itemText.slice(0, 100)}...`);

      const embedding = await this.generateEmbedding(itemText);
      console.log(`🔢 Generated embedding with ${embedding.length} dimensions`);

      // Update the item with embedding and text using raw SQL
      await db.execute(sql`
        UPDATE items 
        SET item_text = ${itemText},
            item_embedding = ${JSON.stringify(embedding)}::vector,
            updated_at = NOW()
        WHERE id = ${itemId}
      `);

      console.log(`✅ Updated item ${itemId} with embedding`);
    } catch (error) {
      console.error(`❌ Error updating item ${itemId} embedding:`, error);
      throw error;
    }
  }

  /**
   * Generate embeddings for items without embeddings
   */
  async generateMissingEmbeddings(limit: number = 50): Promise<{
    processed: number;
    total: number;
    errors: string[];
  }> {
    console.log('🚀 ITEM EMBEDDING: Starting batch embedding generation...');
    
    try {
      // Find items without embeddings using raw SQL to avoid schema issues
      const result = await db.execute(sql`
        SELECT id, sku, final_sku, display_name, description, sub_type, vendor, manufacturer, upc, mpn, attributes
        FROM items 
        WHERE item_embedding IS NULL 
        LIMIT ${limit}
      `);
      const itemsWithoutEmbeddings = result.rows;

      console.log(`📋 Found ${itemsWithoutEmbeddings.length} items without embeddings`);

      const errors: string[] = [];
      let processed = 0;

      for (const item of itemsWithoutEmbeddings) {
        try {
          await this.updateItemEmbedding(item.id, item);
          processed++;
          
          // Add a small delay to avoid rate limits
          if (processed % 10 === 0) {
            console.log(`⏸️ Processed ${processed}/${itemsWithoutEmbeddings.length}, pausing briefly...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          const errorMsg = `Failed to process item ${item.id} (${item.final_sku || item.sku}): ${(error as Error).message}`;
          console.error(`❌ ${errorMsg}`);
          errors.push(errorMsg);
        }
      }

      // Get updated count using raw SQL
      const totalResult = await db.execute(sql`SELECT count(*) as count FROM items`);
      const embeddedResult = await db.execute(sql`SELECT count(*) as count FROM items WHERE item_embedding IS NOT NULL`);

      console.log(`✅ ITEM EMBEDDING: Batch complete`);
      console.log(`   📊 Processed: ${processed}/${itemsWithoutEmbeddings.length}`);
      console.log(`   🎯 Total embedded: ${embeddedResult.rows[0].count}/${totalResult.rows[0].count}`);
      console.log(`   ❌ Errors: ${errors.length}`);

      return {
        processed,
        total: Number(totalResult.rows[0].count),
        errors,
      };
    } catch (error) {
      console.error('❌ Error in batch embedding generation:', error);
      throw error;
    }
  }

  /**
   * Get embedding statistics
   */
  async getEmbeddingStats(): Promise<{
    totalItems: number;
    embeddedItems: number;
    pendingItems: number;
    percentageComplete: number;
  }> {
    try {
      const totalResult = await db.execute(sql`SELECT count(*) as count FROM items`);
      const embeddedResult = await db.execute(sql`SELECT count(*) as count FROM items WHERE item_embedding IS NOT NULL`);

      const totalItems = Number(totalResult.rows[0].count);
      const embeddedItems = Number(embeddedResult.rows[0].count);
      const pendingItems = totalItems - embeddedItems;
      const percentageComplete = totalItems > 0 ? (embeddedItems / totalItems) * 100 : 0;

      return {
        totalItems,
        embeddedItems,
        pendingItems,
        percentageComplete: Math.round(percentageComplete * 100) / 100,
      };
    } catch (error) {
      console.error('Error getting embedding stats:', error);
      throw error;
    }
  }

  /**
   * Regenerate embedding for a specific item
   */
  async regenerateItemEmbedding(itemId: string): Promise<void> {
    try {
      const result = await db.execute(sql`
        SELECT id, sku, final_sku, display_name, description, sub_type, vendor, manufacturer, upc, mpn, attributes
        FROM items 
        WHERE id = ${itemId}
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        throw new Error(`Item not found: ${itemId}`);
      }

      await this.updateItemEmbedding(itemId, result.rows[0]);
      console.log(`✅ Regenerated embedding for item ${itemId}`);
    } catch (error) {
      console.error(`❌ Error regenerating embedding for item ${itemId}:`, error);
      throw error;
    }
  }

  /**
   * Test semantic search with an item query
   */
  async testSemanticSearch(queryText: string, limit: number = 10): Promise<any[]> {
    try {
      console.log(`🔍 Testing semantic search with query: "${queryText}"`);
      
      const queryEmbedding = await this.generateEmbedding(queryText);
      
      const results = await db.execute(sql`
        SELECT 
          id,
          sku,
          final_sku,
          display_name,
          description,
          vendor,
          manufacturer,
          sub_type,
          item_text,
          1 - (item_embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity
        FROM items 
        WHERE item_embedding IS NOT NULL
        ORDER BY item_embedding <=> ${JSON.stringify(queryEmbedding)}::vector
        LIMIT ${limit}
      `);

      console.log(`📊 Found ${results.rows.length} similar items`);
      return results.rows.map((row: any) => ({
        id: row.id,
        sku: row.sku || row.final_sku,
        displayName: row.display_name,
        description: row.description,
        vendor: row.vendor,
        manufacturer: row.manufacturer,
        subType: row.sub_type,
        itemText: row.item_text,
        similarity: parseFloat(row.similarity),
      }));
    } catch (error) {
      console.error('❌ Error in semantic search test:', error);
      throw error;
    }
  }
}