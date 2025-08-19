import OpenAI from "openai";
import { db } from "../db";
import { contacts } from "../../shared/schema";
import { eq, isNull, sql } from "drizzle-orm";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
  return new OpenAI({ apiKey });
}

export class ContactEmbeddingService {
  private openai: OpenAI;
  
  constructor() {
    this.openai = getOpenAIClient();
  }

  /**
   * Build contact text string for consistent embedding generation
   * Format: "name | job_title | email | domain | netsuite_id"
   */
  private buildContactText(contact: any): string {
    const parts = [];
    
    // Core contact info
    if (contact.name) parts.push(contact.name);
    if (contact.jobTitle) parts.push(contact.jobTitle);
    if (contact.email) {
      parts.push(contact.email);
      // Extract domain for better matching
      const domain = contact.email.split('@')[1];
      if (domain) parts.push(domain);
    }
    if (contact.phone) parts.push(contact.phone);
    if (contact.netsuiteInternalId) parts.push(contact.netsuiteInternalId);
    
    return parts.join(" | ");
  }

  /**
   * Generate embedding for a contact text using OpenAI
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small", // 1536 dimensions
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error("Error generating embedding:", error);
      throw error;
    }
  }

  /**
   * Update embedding for a single contact
   */
  async updateContactEmbedding(contactId: string): Promise<void> {
    console.log(`🔄 Updating embedding for contact: ${contactId}`);

    try {
      // Get the contact
      const contact = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);

      if (contact.length === 0) {
        throw new Error(`Contact not found: ${contactId}`);
      }

      const contactData = contact[0];
      
      // Build contact text
      const contactText = this.buildContactText(contactData);
      console.log(`   📝 Contact text: "${contactText}"`);

      // Generate embedding
      const embedding = await this.generateEmbedding(contactText);
      console.log(`   ✅ Generated embedding (${embedding.length} dimensions)`);

      // Update the contact with both text and embedding
      await db
        .update(contacts)
        .set({
          contactText,
          contactEmbedding: embedding,
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, contactId));

      console.log(`   💾 Updated contact ${contactId} with embedding`);
    } catch (error) {
      console.error(`   ❌ Failed to update embedding for contact ${contactId}:`, error);
      throw error;
    }
  }

  /**
   * ULTRA-OPTIMIZED: Generate embeddings in massive parallel batches
   * - Batch OpenAI API calls (up to 100 texts per request)
   * - Parallel database updates
   * - Memory-efficient processing
   */
  async generateMissingEmbeddingsOptimized(batchSize: number = 100): Promise<number> {
    console.log(`🚀 ULTRA-OPTIMIZED EMBEDDING: Starting mega-batch processing (batch size: ${batchSize})`);

    try {
      // Get contacts without embeddings
      const contactsWithoutEmbeddings = await db
        .select()
        .from(contacts)
        .where(isNull(contacts.contactEmbedding))
        .limit(batchSize);

      console.log(`   📊 Found ${contactsWithoutEmbeddings.length} contacts without embeddings`);

      if (contactsWithoutEmbeddings.length === 0) {
        console.log(`   ✅ All contacts already have embeddings`);
        return 0;
      }

      // Build all contact texts in parallel
      const contactTexts = contactsWithoutEmbeddings.map(contact => ({
        id: contact.id,
        text: this.buildContactText(contact)
      }));

      console.log(`   🔥 BATCH PROCESSING: Sending ${contactTexts.length} texts to OpenAI in ONE request`);

      // MASSIVE OPTIMIZATION: Single OpenAI API call for entire batch
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: contactTexts.map(ct => ct.text), // Send all texts at once
      });

      console.log(`   ✅ RECEIVED ${response.data.length} embeddings in single API call`);

      // Prepare batch database updates
      const updates = contactTexts.map((ct, index) => ({
        contactId: ct.id,
        contactText: ct.text,
        embedding: response.data[index].embedding
      }));

      // ULTRA-FAST: Parallel database updates
      await Promise.all(
        updates.map(update => 
          db.update(contacts)
            .set({
              contactText: update.contactText,
              contactEmbedding: update.embedding,
              updatedAt: new Date(),
            })
            .where(eq(contacts.id, update.contactId))
        )
      );

      console.log(`   🎯 Successfully processed ${contactsWithoutEmbeddings.length}/${contactsWithoutEmbeddings.length} contacts`);
      return contactsWithoutEmbeddings.length;

    } catch (error) {
      console.error("❌ Error in optimized batch processing:", error);
      throw error;
    }
  }

  /**
   * Original method kept as fallback
   */
  async generateMissingEmbeddings(batchSize: number = 50): Promise<number> {
    console.log(`🚀 EMBEDDING GENERATION: Starting batch processing (batch size: ${batchSize})`);

    try {
      // Get contacts without embeddings
      const contactsWithoutEmbeddings = await db
        .select()
        .from(contacts)
        .where(isNull(contacts.contactEmbedding))
        .limit(batchSize);

      console.log(`   📊 Found ${contactsWithoutEmbeddings.length} contacts without embeddings`);

      if (contactsWithoutEmbeddings.length === 0) {
        console.log(`   ✅ All contacts already have embeddings`);
        return 0;
      }

      let processedCount = 0;
      for (const contact of contactsWithoutEmbeddings) {
        try {
          await this.updateContactEmbedding(contact.id);
          processedCount++;
          
          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`   ⚠️  Failed to process contact ${contact.id}:`, error);
          // Continue with other contacts
        }
      }

      console.log(`   🎯 Successfully processed ${processedCount}/${contactsWithoutEmbeddings.length} contacts`);
      return processedCount;
    } catch (error) {
      console.error(`   ❌ Batch embedding generation failed:`, error);
      throw error;
    }
  }

  /**
   * Regenerate all contact embeddings (useful for schema changes)
   */
  async regenerateAllEmbeddings(batchSize: number = 25): Promise<number> {
    console.log(`🔄 EMBEDDING REGENERATION: Starting full regeneration (batch size: ${batchSize})`);

    try {
      // Get total count first
      const totalCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(contacts);

      console.log(`   📊 Total contacts to process: ${totalCount[0].count}`);

      let processedCount = 0;
      let offset = 0;

      while (true) {
        // Get batch of contacts
        const batch = await db
          .select()
          .from(contacts)
          .limit(batchSize)
          .offset(offset);

        if (batch.length === 0) break;

        console.log(`   🔄 Processing batch ${Math.floor(offset / batchSize) + 1} (${batch.length} contacts)`);

        for (const contact of batch) {
          try {
            await this.updateContactEmbedding(contact.id);
            processedCount++;
          } catch (error) {
            console.error(`   ⚠️  Failed to process contact ${contact.id}:`, error);
          }
          
          // Rate limiting delay
          await new Promise(resolve => setTimeout(resolve, 150));
        }

        offset += batchSize;
      }

      console.log(`   🎯 Successfully regenerated embeddings for ${processedCount} contacts`);
      return processedCount;
    } catch (error) {
      console.error(`   ❌ Full regeneration failed:`, error);
      throw error;
    }
  }

  /**
   * Get embedding statistics
   */
  async getEmbeddingStats(): Promise<{
    total: number;
    withEmbeddings: number;
    withoutEmbeddings: number;
    percentage: number;
  }> {
    try {
      const [totalResult, withEmbeddingsResult] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(contacts),
        db.select({ count: sql<number>`count(*)` }).from(contacts).where(sql`contact_embedding IS NOT NULL`)
      ]);

      const total = totalResult[0].count;
      const withEmbeddings = withEmbeddingsResult[0].count;
      const withoutEmbeddings = total - withEmbeddings;
      const percentage = total > 0 ? (withEmbeddings / total) * 100 : 0;

      return {
        total,
        withEmbeddings,
        withoutEmbeddings,
        percentage: Math.round(percentage * 100) / 100
      };
    } catch (error) {
      console.error("Error getting embedding stats:", error);
      throw error;
    }
  }
}

// Export singleton instance
export const contactEmbeddingService = new ContactEmbeddingService();