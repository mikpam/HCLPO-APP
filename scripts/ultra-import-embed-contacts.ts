#!/usr/bin/env tsx
import { db } from "../server/db";
import { contacts } from "../shared/schema";
import { sql } from "drizzle-orm";
import fs from "fs";
import { parse } from "csv-parse/sync";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ContactRow {
  'Internal ID': string;
  'Name': string;
  'Email': string;
  'Phone': string;
  'Office Phone': string;
  'Fax': string;
  'Company': string;
  'Alt. Email': string;
}

async function importAndEmbedContacts() {
  console.log("🚀 ULTRA CONTACT IMPORT & EMBEDDING: Starting...");
  
  // Find all contact CSV files
  const contactFiles = [
    'attached_assets/ContactSearchResults926_1755654273634.csv',
    'attached_assets/ContactSearchResults926_1755669764162.csv',
    'attached_assets/HCL contacts_1755401796156.csv'
  ];
  
  const allContacts = new Map<string, any>();
  
  // Read and parse all CSV files
  for (const file of contactFiles) {
    if (!fs.existsSync(file)) {
      console.log(`   ⚠️ File not found: ${file}`);
      continue;
    }
    
    console.log(`📂 Reading ${file}...`);
    const content = fs.readFileSync(file, 'utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true
    }) as ContactRow[];
    
    console.log(`   📋 Found ${records.length} records`);
    
    // Process each contact
    for (const record of records) {
      const internalId = record['Internal ID']?.trim();
      const email = record['Email']?.trim()?.toLowerCase();
      const name = record['Name']?.trim();
      
      // Skip if no ID or name
      if (!internalId || !name) continue;
      
      // Use internal ID as unique key
      const key = internalId;
      
      // Store contact (overwrites duplicates)
      allContacts.set(key, {
        netsuiteInternalId: internalId,
        name: name,
        email: email || null,
        phone: record['Phone']?.trim() || null,
        officePhone: record['Office Phone']?.trim() || null,
        fax: record['Fax']?.trim() || null,
        companyName: record['Company']?.trim() || null,
        altEmail: record['Alt. Email']?.trim() || null
      });
    }
  }
  
  console.log(`\n📊 Total unique contacts to import: ${allContacts.size}`);
  
  if (allContacts.size === 0) {
    console.log("❌ No contacts to import!");
    process.exit(1);
  }
  
  // Clear existing contacts
  console.log("\n🗑️ Clearing existing contacts...");
  await db.delete(contacts);
  
  // Convert to array for batch processing
  const contactArray = Array.from(allContacts.values());
  
  // Insert contacts in batches
  const INSERT_BATCH_SIZE = 500;
  let insertedCount = 0;
  
  console.log("\n💾 Inserting contacts into database...");
  for (let i = 0; i < contactArray.length; i += INSERT_BATCH_SIZE) {
    const batch = contactArray.slice(i, i + INSERT_BATCH_SIZE);
    
    await db.insert(contacts).values(
      batch.map(contact => ({
        netsuiteInternalId: contact.netsuiteInternalId,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        officePhone: contact.officePhone,
        fax: contact.fax,
        companyName: contact.companyName,
        altEmail: contact.altEmail,
        createdAt: new Date(),
        updatedAt: new Date()
      }))
    );
    
    insertedCount += batch.length;
    console.log(`   ✅ Inserted ${insertedCount}/${contactArray.length} contacts`);
  }
  
  // Now generate embeddings using ultra method
  console.log("\n⚡ ULTRA EMBEDDING: Generating embeddings for all contacts...");
  
  const contactsNeedingEmbeddings = await db
    .select({
      id: contacts.id,
      netsuiteInternalId: contacts.netsuiteInternalId,
      name: contacts.name,
      email: contacts.email,
      companyName: contacts.companyName,
      phone: contacts.phone
    })
    .from(contacts);
    
  console.log(`📊 Processing ${contactsNeedingEmbeddings.length} contacts for embeddings`);
  
  const EMBED_BATCH_SIZE = 500;
  const CONCURRENT_BATCHES = 5;
  let totalProcessed = 0;
  
  // Process in mega-batches
  for (let i = 0; i < contactsNeedingEmbeddings.length; i += EMBED_BATCH_SIZE * CONCURRENT_BATCHES) {
    const megaBatch = contactsNeedingEmbeddings.slice(i, i + EMBED_BATCH_SIZE * CONCURRENT_BATCHES);
    
    // Split into concurrent batches
    const batches = [];
    for (let j = 0; j < megaBatch.length; j += EMBED_BATCH_SIZE) {
      batches.push(megaBatch.slice(j, j + EMBED_BATCH_SIZE));
    }
    
    console.log(`\n⚡ Processing mega-batch: ${i} to ${Math.min(i + EMBED_BATCH_SIZE * CONCURRENT_BATCHES, contactsNeedingEmbeddings.length)}`);
    
    // Process all batches in parallel
    const batchPromises = batches.map(async (batch, batchIndex) => {
      try {
        // Create text for all contacts in this batch
        const texts = batch.map(contact => {
          const parts = [
            contact.name,
            contact.email || '',
            contact.companyName || '',
            contact.phone || ''
          ].filter(Boolean);
          return parts.join(' | ');
        });
        
        console.log(`   📦 Batch ${batchIndex + 1}: Generating ${texts.length} embeddings...`);
        
        // Generate all embeddings in one API call
        const response = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: texts
        });
        
        // Update database in parallel
        const updatePromises = batch.map(async (contact, idx) => {
          const embedding = response.data[idx].embedding;
          const embeddingString = `[${embedding.join(',')}]`;
          
          await db
            .update(contacts)
            .set({ 
              contactEmbedding: sql`${embeddingString}::vector`,
              updatedAt: new Date()
            })
            .where(sql`id = ${contact.id}`);
            
          return contact.netsuiteInternalId;
        });
        
        const processed = await Promise.all(updatePromises);
        console.log(`   ✅ Batch ${batchIndex + 1}: ${processed.length} contacts embedded`);
        return processed.length;
        
      } catch (error) {
        console.error(`   ❌ Batch ${batchIndex + 1} error:`, error.message);
        return 0;
      }
    });
    
    const results = await Promise.all(batchPromises);
    const batchProcessed = results.reduce((sum, count) => sum + count, 0);
    totalProcessed += batchProcessed;
    
    console.log(`   ⚡ Mega-batch complete: ${batchProcessed} contacts processed`);
    console.log(`   📈 Total progress: ${totalProcessed}/${contactsNeedingEmbeddings.length} (${Math.round(totalProcessed/contactsNeedingEmbeddings.length*100)}%)`);
    
    // Small delay between mega-batches
    if (i + EMBED_BATCH_SIZE * CONCURRENT_BATCHES < contactsNeedingEmbeddings.length) {
      console.log(`   ⏳ Cooling down for 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Final verification
  const finalStats = await db
    .select({
      totalContacts: sql<number>`count(*)`,
      withEmbeddings: sql<number>`count(contact_embedding)`,
      withoutEmbeddings: sql<number>`count(*) filter (where contact_embedding is null)`
    })
    .from(contacts);
    
  console.log("\n✨ ULTRA IMPORT & EMBEDDING COMPLETE!");
  console.log(`   📊 Total contacts: ${finalStats[0].totalContacts}`);
  console.log(`   ✅ With embeddings: ${finalStats[0].withEmbeddings}`);
  console.log(`   ❌ Without embeddings: ${finalStats[0].withoutEmbeddings}`);
  
  process.exit(0);
}

// Run with error handling
importAndEmbedContacts().catch(error => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});