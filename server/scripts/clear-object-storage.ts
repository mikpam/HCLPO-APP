#!/usr/bin/env tsx

/**
 * Script to clear all stored files from object storage
 * This removes PDFs and email files to reset for testing
 */

import { ObjectStorageService } from '../objectStorage.js';

async function clearObjectStorage() {
  try {
    console.log('🗑️  Starting object storage cleanup...');
    
    const objectStorageService = new ObjectStorageService();
    const privateObjectDir = objectStorageService.getPrivateObjectDir();
    
    console.log(`📁 Private object directory: ${privateObjectDir}`);
    
    // Import the storage client directly
    const { objectStorageClient } = await import('../objectStorage.js');
    
    // Parse the private object directory to get bucket and prefix
    const pathParts = privateObjectDir.split('/');
    if (pathParts.length < 2) {
      throw new Error('Invalid private object directory format');
    }
    
    const bucketName = pathParts[1];
    const prefix = pathParts.slice(2).join('/');
    
    console.log(`🪣 Bucket: ${bucketName}`);
    console.log(`📂 Prefix: ${prefix}`);
    
    const bucket = objectStorageClient.bucket(bucketName);
    
    // List all files with our prefix
    console.log('📋 Listing files to delete...');
    const [files] = await bucket.getFiles({
      prefix: prefix
    });
    
    console.log(`Found ${files.length} files to delete`);
    
    if (files.length === 0) {
      console.log('✅ No files found - object storage is already clean');
      return;
    }
    
    // Delete files in batches
    const batchSize = 100;
    let deletedCount = 0;
    
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      console.log(`🗑️  Deleting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(files.length / batchSize)} (${batch.length} files)...`);
      
      const deletePromises = batch.map(async (file) => {
        try {
          await file.delete();
          console.log(`   ✅ Deleted: ${file.name}`);
          return true;
        } catch (error) {
          console.error(`   ❌ Failed to delete ${file.name}:`, error);
          return false;
        }
      });
      
      const results = await Promise.all(deletePromises);
      deletedCount += results.filter(Boolean).length;
      
      // Small delay between batches
      if (i + batchSize < files.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`\n🎉 Object storage cleanup complete!`);
    console.log(`   ✅ Successfully deleted: ${deletedCount} files`);
    console.log(`   ❌ Failed to delete: ${files.length - deletedCount} files`);
    console.log(`   📁 Object storage is now clean and ready for testing`);
    
  } catch (error) {
    console.error('❌ Object storage cleanup failed:', error);
    process.exit(1);
  }
}

// Run the script
clearObjectStorage().then(() => {
  console.log('✅ Cleanup script completed successfully');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Cleanup script failed:', error);
  process.exit(1);
});