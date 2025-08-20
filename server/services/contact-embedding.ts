import OpenAI from "openai";
import { db } from "../db";
import { contacts } from "../../shared/schema";
import { eq, isNull, sql, and } from "drizzle-orm";

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
   * Generate embeddings for a contact and store in database
   */
  async updateContactEmbedding(contactId: string): Promise<void> {
    try {
      console.log(`🔄 Processing contact ${contactId}...`);

      // Get the contact
      const contact = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);

      if (contact.length === 0) {
        throw new Error(`Contact ${contactId} not found`);
      }

      const contactData = contact[0];

      // Build contact text
      const contactText = this.buildContactText(contactData);
      console.log(`   📝 Contact text: ${contactText}`);

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

      console.log(`   💾 Updated ${updates.length} contacts with embeddings`);
      return updates.length;

    } catch (error) {
      console.error(`   ❌ ULTRA-OPTIMIZED EMBEDDING ERROR:`, error);
      throw error;
    }
  }

  /**
   * ACTIVE CONTACTS ONLY: Generate embeddings for active contacts in massive parallel batches
   * - Only processes contacts where inactive = false
   * - Batch OpenAI API calls (up to 100 texts per request)
   * - Parallel database updates
   * - Memory-efficient processing
   */
  async generateActiveContactEmbeddingsOptimized(batchSize: number = 100): Promise<number> {
    console.log(`🚀 ACTIVE CONTACTS ULTRA-OPTIMIZED EMBEDDING: Starting mega-batch processing (batch size: ${batchSize})`);

    try {
      // Get ACTIVE contacts without embeddings
      const contactsWithoutEmbeddings = await db
        .select()
        .from(contacts)
        .where(and(
          isNull(contacts.contactEmbedding),
          eq(contacts.inactive, false)
        ))
        .limit(batchSize);

      console.log(`   📊 Found ${contactsWithoutEmbeddings.length} ACTIVE contacts without embeddings`);

      if (contactsWithoutEmbeddings.length === 0) {
        console.log(`   ✅ All active contacts already have embeddings`);
        return 0;
      }

      // Build all contact texts in parallel
      const contactTexts = contactsWithoutEmbeddings.map(contact => ({
        id: contact.id,
        text: this.buildContactText(contact)
      }));

      console.log(`   🔥 ACTIVE BATCH PROCESSING: Sending ${contactTexts.length} texts to OpenAI in ONE request`);

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

      console.log(`   💾 Updated ${updates.length} ACTIVE contacts with embeddings`);
      return updates.length;

    } catch (error) {
      console.error(`   ❌ ACTIVE CONTACTS ULTRA-OPTIMIZED EMBEDDING ERROR:`, error);
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
      const totalCount = await db.select({ count: sql<number>`count(*)` }).from(contacts);
      console.log(`   📊 Total contacts to regenerate: ${totalCount[0].count}`);

      let processedCount = 0;
      let offset = 0;

      while (true) {
        const contactBatch = await db
          .select()
          .from(contacts)
          .limit(batchSize)
          .offset(offset);

        if (contactBatch.length === 0) break;

        console.log(`   📦 Processing batch ${Math.floor(offset / batchSize) + 1}: ${contactBatch.length} contacts`);

        for (const contact of contactBatch) {
          try {
            await this.updateContactEmbedding(contact.id);
            processedCount++;
            
            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 150));
          } catch (error) {
            console.error(`   ⚠️  Failed to regenerate embedding for contact ${contact.id}:`, error);
            // Continue with other contacts
          }
        }

        offset += batchSize;
        console.log(`   📈 Progress: ${processedCount}/${totalCount[0].count} contacts`);
      }

      console.log(`   🎯 Regeneration complete: ${processedCount}/${totalCount[0].count} contacts`);
      return processedCount;
    } catch (error) {
      console.error(`   ❌ Embedding regeneration failed:`, error);
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
        db.select({ count: sql<number>`count(*)` }).from(contacts).where(isNull(contacts.contactEmbedding))
      ]);

      const total = totalResult[0].count;
      const withEmbeddings = withEmbeddingsResult[0].count;
      const withoutEmbeddings = total - withEmbeddings;
      const percentage = total > 0 ? (withEmbeddings / total) * 100 : 0;

      return {
        total,
        withEmbeddings,
        withoutEmbeddings,
        percentage
      };
    } catch (error) {
      console.error(`   ❌ Failed to get embedding stats:`, error);
      throw error;
    }
  }
}