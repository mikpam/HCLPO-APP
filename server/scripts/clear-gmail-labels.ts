#!/usr/bin/env tsx

/**
 * Script to clear Gmail labels from all emails to reset for testing
 * This removes processing labels so emails can be reprocessed
 */

import { GmailService } from '../services/gmail.js';

async function clearGmailLabels() {
  try {
    console.log('🔄 Starting Gmail label cleanup...');
    
    const gmailService = new GmailService();
    
    // Labels to remove from emails
    const labelsToRemove = [
      'processed',
      'ai-purchase-order', 
      'ai-sample-request',
      'ai-rush-order',
      'ai-follow-up',
      'ai-none-of-these'
    ];
    
    console.log(`📧 Fetching emails with processing labels...`);
    
    // Get all emails with any of these labels
    for (const label of labelsToRemove) {
      console.log(`\n🏷️  Processing label: ${label}`);
      
      try {
        const emails = await gmailService.getEmailsWithLabel(label);
        console.log(`   Found ${emails.length} emails with label '${label}'`);
        
        if (emails.length > 0) {
          // Remove label from all emails
          for (const email of emails) {
            try {
              await gmailService.removeLabelFromEmail(email.id, label);
              console.log(`   ✅ Removed '${label}' from: ${email.subject?.substring(0, 50)}...`);
            } catch (error) {
              console.error(`   ❌ Failed to remove label from ${email.id}:`, error);
            }
          }
        }
      } catch (error) {
        console.error(`   ⚠️  Error processing label '${label}':`, error);
      }
    }
    
    // Also remove 'unprocessed' label and re-add it to reset state
    console.log(`\n🔄 Resetting 'unprocessed' label...`);
    try {
      const unprocessedEmails = await gmailService.getEmailsWithLabel('unprocessed');
      console.log(`   Found ${unprocessedEmails.length} emails with 'unprocessed' label`);
      
      // Remove unprocessed label first
      for (const email of unprocessedEmails) {
        await gmailService.removeLabelFromEmail(email.id, 'unprocessed');
      }
      
      // Add unprocessed label back to all purchase-order emails
      const purchaseOrderEmails = await gmailService.getEmailsWithLabel('purchase-order');
      console.log(`   Adding 'unprocessed' label to ${purchaseOrderEmails.length} purchase-order emails`);
      
      for (const email of purchaseOrderEmails) {
        await gmailService.addLabelToEmail(email.id, 'unprocessed');
        console.log(`   ✅ Added 'unprocessed' to: ${email.subject?.substring(0, 50)}...`);
      }
      
    } catch (error) {
      console.error(`   ⚠️  Error resetting unprocessed label:`, error);
    }
    
    console.log('\n🎉 Gmail label cleanup complete!');
    console.log('   All processing labels removed');
    console.log('   Emails reset to unprocessed state');
    console.log('   Ready for fresh bulk processing test');
    
  } catch (error) {
    console.error('❌ Gmail cleanup failed:', error);
    process.exit(1);
  }
}

// Run the script
clearGmailLabels().then(() => {
  console.log('✅ Script completed successfully');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});