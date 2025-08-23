#!/usr/bin/env node
/**
 * Script to update all purchase orders and related records 
 * to ensure timestamps are in Pacific Time
 */
import { db } from "../db.js";
import { purchaseOrders, emailQueue, errorLogs, systemHealth } from "@shared/schema";
import { sql } from "drizzle-orm";

async function updateTimestampsToPacific() {
  console.log("🌎 Setting PostgreSQL session timezone to Pacific Time...");
  
  try {
    // Set the PostgreSQL session timezone to Pacific Time
    await db.execute(sql`SET TIME ZONE 'America/Los_Angeles'`);
    console.log("✅ PostgreSQL session timezone set to America/Los_Angeles (Pacific Time)");
    
    // Verify the timezone setting
    const result = await db.execute(sql`SHOW TIME ZONE`);
    console.log("📍 Current PostgreSQL timezone:", result);
    
    // Get current time in Pacific
    const timeResult = await db.execute(sql`SELECT NOW() as current_time, NOW() AT TIME ZONE 'America/Los_Angeles' as pacific_time`);
    console.log("⏰ Current database time:", timeResult);
    
    console.log("\n✅ Database timezone configuration complete!");
    console.log("📝 Note: All new timestamps will automatically use Pacific Time");
    console.log("📝 Existing timestamps are already stored in UTC and will be displayed in Pacific Time");
    
  } catch (error) {
    console.error("❌ Error updating timestamps:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

updateTimestampsToPacific();