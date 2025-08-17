import { db } from '../db';
import { contacts } from '../../shared/schema';
import { eq, ilike, or, sql } from 'drizzle-orm';

interface ContactDetails {
  name?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  netsuiteInternalId?: string;
}

interface ContactMatch {
  netsuite_internal_id: string;
  name: string;
  email?: string;
  job_title?: string;
  phone?: string;
  confidence: number;
}

export class ContactFinderService {
  
  // Normalize text for comparison
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s@.-]/g, '') // Keep alphanumeric, spaces, @, ., -
      .trim();
  }

  // Generate name variations for fuzzy matching
  private generateNameVariations(name: string): string[] {
    const variations: string[] = [];
    const normalized = this.normalizeText(name);
    
    // Original name
    variations.push(normalized);
    
    // First name + last name variations
    const parts = normalized.split(' ').filter(p => p.length > 1);
    if (parts.length >= 2) {
      // First + Last
      variations.push(`${parts[0]} ${parts[parts.length - 1]}`);
      // Last, First
      variations.push(`${parts[parts.length - 1]}, ${parts[0]}`);
      // Last + First
      variations.push(`${parts[parts.length - 1]} ${parts[0]}`);
    }
    
    return Array.from(new Set(variations));
  }

  async findContact(details: ContactDetails): Promise<ContactMatch | null> {
    console.log(`🔍 CONTACT FINDER: Starting lookup with details:`, {
      name: details.name,
      email: details.email,
      phone: details.phone,
      jobTitle: details.jobTitle,
      netsuiteInternalId: details.netsuiteInternalId
    });

    // 1. Direct NetSuite Internal ID lookup (highest priority)
    if (details.netsuiteInternalId) {
      console.log(`   🎯 Direct NetSuite ID lookup: ${details.netsuiteInternalId}`);
      try {
        const directMatch = await db
          .select()
          .from(contacts)
          .where(eq(contacts.netsuiteInternalId, details.netsuiteInternalId))
          .limit(1);
        
        if (directMatch.length > 0) {
          const match: ContactMatch = {
            netsuite_internal_id: directMatch[0].netsuiteInternalId,
            name: directMatch[0].name,
            email: directMatch[0].email || undefined,
            job_title: directMatch[0].jobTitle || undefined,
            phone: directMatch[0].phone || undefined,
            confidence: 1.0
          };
          console.log(`   ✅ Direct NetSuite ID match found:`, match);
          return match;
        } else {
          console.log(`   ❌ No direct NetSuite ID match found for: ${details.netsuiteInternalId}`);
        }
      } catch (error) {
        console.error(`   ❌ Error in direct NetSuite ID lookup:`, error);
      }
    }

    // 2. Exact Email Match (Priority 2)
    if (details.email) {
      console.log(`   📧 Email matching: ${details.email}`);
      try {
        const emailMatch = await db
          .select()
          .from(contacts)
          .where(eq(contacts.email, details.email))
          .limit(1);
        
        if (emailMatch.length > 0) {
          const match: ContactMatch = {
            netsuite_internal_id: emailMatch[0].netsuiteInternalId,
            name: emailMatch[0].name,
            email: emailMatch[0].email || undefined,
            job_title: emailMatch[0].jobTitle || undefined,
            phone: emailMatch[0].phone || undefined,
            confidence: 0.95
          };
          console.log(`   ✅ Exact email match found:`, match);
          return match;
        }
      } catch (error) {
        console.error(`   ❌ Error in email lookup:`, error);
      }
    }

    // 3. Name-based matching with fuzzy logic (Priority 3)
    if (details.name) {
      console.log(`   👤 Name matching: ${details.name}`);
      
      const nameVariations = this.generateNameVariations(details.name);
      console.log(`   🔍 Generated name variations:`, nameVariations);
      
      try {
        // Try exact name matches first
        for (const variation of nameVariations) {
          const nameMatches = await db
            .select()
            .from(contacts)
            .where(
              or(
                eq(contacts.name, variation),
                ilike(contacts.name, variation),
                ilike(contacts.searchVector, `%${variation}%`)
              )
            )
            .limit(5);
          
          if (nameMatches.length > 0) {
            console.log(`   📋 Found ${nameMatches.length} name-based candidates`);
            
            // Pick the best match based on additional criteria
            let bestMatch = nameMatches[0];
            let bestScore = 0.7;
            
            for (const candidate of nameMatches) {
              let score = 0.7; // Base score for name match
              
              // Boost score for email match
              if (details.email && candidate.email === details.email) {
                score += 0.2;
              }
              
              // Boost score for phone match  
              if (details.phone && candidate.phone === details.phone) {
                score += 0.1;
              }
              
              // Boost score for job title match
              if (details.jobTitle && candidate.jobTitle && 
                  this.normalizeText(candidate.jobTitle).includes(this.normalizeText(details.jobTitle))) {
                score += 0.1;
              }
              
              if (score > bestScore) {
                bestMatch = candidate;
                bestScore = score;
              }
            }
            
            const match: ContactMatch = {
              netsuite_internal_id: bestMatch.netsuiteInternalId,
              name: bestMatch.name,
              email: bestMatch.email || undefined,
              job_title: bestMatch.jobTitle || undefined,
              phone: bestMatch.phone || undefined,
              confidence: bestScore
            };
            console.log(`   ✅ Name-based match found:`, match);
            return match;
          }
        }
      } catch (error) {
        console.error(`   ❌ Error in name lookup:`, error);
      }
    }

    // No confident match found
    console.log(`   ❌ No confident contact match found`);
    return null;
  }

  // Validate a contact against the database
  async validateContact(contactDetails: ContactDetails): Promise<{
    isValid: boolean;
    match?: ContactMatch;
    confidence: number;
  }> {
    const match = await this.findContact(contactDetails);
    
    if (match && match.confidence >= 0.7) {
      return {
        isValid: true,
        match,
        confidence: match.confidence
      };
    }
    
    return {
      isValid: false,
      confidence: match?.confidence || 0
    };
  }
}

export const contactFinderService = new ContactFinderService();