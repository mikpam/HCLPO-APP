#!/usr/bin/env tsx

import { pool } from '../db';

async function clearDatabase() {
  try {
    console.log('🗑️  Starting database cleanup...');
    
    // Clear purchase orders
    const poResult = await pool.query('DELETE FROM purchase_orders');
    console.log(`   ✅ Deleted ${poResult.rowCount} purchase orders`);
    
    // Clear email queue
    const queueResult = await pool.query('DELETE FROM email_queue');
    console.log(`   ✅ Deleted ${queueResult.rowCount} email queue items`);
    
    // Clear error logs
    const errorResult = await pool.query('DELETE FROM error_logs');
    console.log(`   ✅ Deleted ${errorResult.rowCount} error logs`);
    
    // Clear system health records (optional)
    const healthResult = await pool.query('DELETE FROM system_health');
    console.log(`   ✅ Deleted ${healthResult.rowCount} health records`);
    
    console.log('\n🎉 Database cleanup complete!');
    console.log('   📊 All purchase orders, email queue, and error logs cleared');
    console.log('   🔄 Database is ready for fresh testing');
    
  } catch (error) {
    console.error('❌ Database cleanup failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

clearDatabase().catch(console.error);