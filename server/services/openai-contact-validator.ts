import OpenAI from 'openai';
import { db } from '../db';
import { contacts, customers } from '@shared/schema';
import { eq, and, ilike, desc, sql } from 'drizzle-orm';

interface ContactInput {
  extractedData?: any;
  senderName?: string;
  senderEmail?: string;
  replyTo?: string;
  ccEmails?: string[];
  threadParticipants?: string[];
  resolvedCustomerId?: string;
  companyId?: string;
}

interface ValidatedContact {
  name: string;
  email: string;
  phone: string;
  role: 'Purchasing' | 'Accounts Payable' | 'Sales' | 'Owner' | 'CSR' | 'Unknown';
  matched_contact_id: string;
  match_method: 'EXTRACTED_JSON' | 'SENDER_EMAIL_EXACT' | 'SENDER_DOMAIN' | 'THREAD_PARTICIPANT' | 'CUSTOMER_DEFAULT' | 'FUZZY_NAME' | 'SIG_PARSE' | 'UNKNOWN' | 'VECTOR_SEARCH';
  confidence: number;
  evidence: string[];
  verified?: boolean;
  associated_customer?: {
    customer_number: string;
    company_name: string;
  };
}

export class OpenAIContactValidatorService {
  private openai: OpenAI;
  private contactsCache: Map<string, any> = new Map();
  private customersCache: Map<string, any> = new Map();
  private lastCacheUpdate = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required');
    }
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  private async loadCaches(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCacheUpdate < this.CACHE_TTL && this.contactsCache.size > 0) {
      return; // Cache is still valid
    }

    try {
      // Load ALL active contacts for better matching (we have 49K contacts)
      const allContacts = await db
        .select()
        .from(contacts)
        .where(eq(contacts.inactive, false));
      
      this.contactsCache.clear();
      for (const contact of allContacts) {
        if (contact.email) { // Add null safety
          this.contactsCache.set(contact.email.toLowerCase(), contact);
        }
      }

      // MEMORY OPTIMIZATION: Load only top 2000 customers instead of all 11,000+
      const allCustomers = await db
        .select()
        .from(customers)
        .limit(2000);
      
      this.customersCache.clear();
      for (const customer of allCustomers) {
        this.customersCache.set(customer.customerNumber, customer);
      }
      
      this.lastCacheUpdate = now;
      console.log(`   📞 Loaded ${this.contactsCache.size} contacts and ${this.customersCache.size} customers into cache (memory optimized)`);
    } catch (error) {
      console.error('Failed to load contact/customer cache:', error);
    }
  }

  private async validateWithOpenAI(input: ContactInput): Promise<ValidatedContact> {
    await this.loadCaches();
    
    // Create context for OpenAI
    const extractedDataContext = input.extractedData ? JSON.stringify(input.extractedData, null, 2) : 'No extracted data';
    
    // Get relevant contacts for context (up to 50)
    const relevantContacts = Array.from(this.contactsCache.values()).slice(0, 50).map(contact => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phones: contact.phones || [],
      role: contact.role,
      company_id: contact.companyId,
      is_active: !contact.inactive // Database uses 'inactive' field where false = active
    }));

    // Get customer info if available
    let customerContext = '';
    if (input.resolvedCustomerId || input.companyId) {
      const customerId = input.resolvedCustomerId || input.companyId;
      const customer = Array.from(this.customersCache.values()).find(c => 
        c.customerNumber === customerId || c.id === customerId
      );
      if (customer) {
        customerContext = `Customer: ${customer.companyName} (${customer.customerNumber})`;
      }
    }

    const prompt = `You are a contact-resolution assistant for High Caliber Line (HCL).

### Goal
Return exactly ONE best contact for this purchase order context.

### Output (strict)
Return ONLY a single JSON object with these keys, in this order:

{
  "name": "string",                  // Full name, properly cased
  "email": "string",                 // Lowercased; RFC5322-valid
  "phone": "string",                 // E.164 preferred if possible, else raw
  "role": "Purchasing|Accounts Payable|Sales|Owner|CSR|Unknown",
  "matched_contact_id": "string",    // Internal Contacts DB primary key or ""
  "match_method": "EXTRACTED_JSON|SENDER_EMAIL_EXACT|SENDER_DOMAIN|THREAD_PARTICIPANT|CUSTOMER_DEFAULT|FUZZY_NAME|SIG_PARSE",
  "confidence": 0.0,                 // 0–1
  "evidence": [ "string" ]           // short bullets; sources & cues used
}

No markdown, no comments, no extra text.

---

### Selection Order (hard priority)
Follow this order, stop at the first successful, valid hit. Set "match_method" accordingly.

1) **EXTRACTED_JSON**
   - If extracted JSON includes a clearly intended contact (e.g., salesPersonEmail, buyerEmail, accountingEmail, or a name+email pair),
   - Validate email syntax. If valid:
     - If ContactsDB has exact email match and is_active → choose it.
     - Else construct a temporary contact (matched_contact_id = ""), but only if company matches the resolved customer or email domain matches customer domains.

2) **SENDER_EMAIL_EXACT**
   - Exact match on the message sender's email in ContactsDB & is_active = true → choose it.

3) **SENDER_DOMAIN**
   - If sender's domain matches a CustomersDB domain for the resolved customer:
     - From contacts.byDomain(sender_domain) within that company_id, choose the most recent, role-prioritized contact:
       Priority by role: Purchasing > Accounts Payable > Sales > CSR > Owner > Unknown.
       Tie-breakers: last_seen_at (desc) → exact domain email → complete profile (has phone) → lexicographic by name.

4) **THREAD_PARTICIPANT**
   - If thread participants (reply-to/cc) include any ContactsDB exact email for the company → apply the same role/tie-breakers and choose top.

5) **CUSTOMER_DEFAULT**
   - If CustomersDB.default_contact_id exists and the contact is active → choose it.

6) **FUZZY_NAME**
   - If extracted JSON has a person name (e.g., "Attn: Jane Smith"), run contacts.byNameLike(name, company_id).
   - Accept only if a single high-confidence hit (≥0.90 normalized token match), else skip.

7) **SIG_PARSE**
   - If an email signature block was parsed (job title/phone), and email domain matches the customer:
     - Use that email if syntax is valid and not previously tried; if not in DB, construct temporary (matched_contact_id = "").

If none succeed, return a placeholder with:
- name="", email="", phone="", role="Unknown", matched_contact_id="", match_method="UNKNOWN", confidence=0.0, evidence=[].

---

### Validation & Normalization
- **Email**: must contain a single "@", no spaces; lowercase output. If invalid → reject that candidate and continue.
- **Phone**: strip non-digits except leading "+". If US-format plausible (10 or 11 digits with leading "1"), format as E.164: +1XXXXXXXXXX.
- **Name casing**: Title-case tokens; preserve known acronyms (LLC, Inc, Co., USA).
- **Role inference (if missing)**:
  - Keywords in title/email/local-part:
    - Purchasing: "purchasing", "buyer", "procure"
    - Accounts Payable: "ap@", "payable", "accountspayable", "billing"
    - Sales/CSR: "sales", "csr", "rep", "account manager"
    - Owner: "owner", "ceo", "president", "principal"
  - Default to "Unknown".

---

### Confidence scoring (guidance)
- 0.95–1.00: exact email match to active contact (methods 1/2), or thread participant exact match (4).
- 0.85–0.94: domain match with strong role signal & recent activity (3).
- 0.70–0.84: customer default contact (5) or high-confidence name match (6).
- 0.50–0.69: signature-derived contact with valid domain (7).
- <0.50: anything partial/ambiguous.

---

### Context Data:

**Message Details:**
- Sender: ${input.senderName || 'N/A'} <${input.senderEmail || 'N/A'}>
- Reply-To: ${input.replyTo || 'N/A'}
- CC: ${input.ccEmails?.join(', ') || 'None'}
- Thread Participants: ${input.threadParticipants?.join(', ') || 'None'}

**Customer Context:**
${customerContext || 'No customer resolved'}

**Extracted PO Data:**
${extractedDataContext}

**Available Contacts (sample of 50):**
${JSON.stringify(relevantContacts, null, 2)}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o', // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      // Parse JSON response - remove markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      const validatedContact = JSON.parse(cleanContent) as ValidatedContact;
      
      // Ensure all required fields are present
      if (!validatedContact.name && !validatedContact.email) {
        return {
          name: '',
          email: '',
          phone: '',
          role: 'Unknown',
          matched_contact_id: '',
          match_method: 'UNKNOWN',
          confidence: 0.0,
          evidence: ['No valid contact found']
        };
      }

      return validatedContact;
    } catch (error) {
      console.error('OpenAI contact validation error:', error);
      // Fallback to basic contact resolution
      return this.fallbackContactResolution(input);
    }
  }

  private async vectorSearchContact(input: ContactInput): Promise<ValidatedContact | null> {
    try {
      // Create query text from available data
      const queryText = [
        input.extractedData?.purchaseOrder?.contact?.name,
        input.extractedData?.purchaseOrder?.contact?.email,
        input.extractedData?.purchaseOrder?.customer?.company,
        input.senderName,
        input.senderEmail
      ].filter(Boolean).join(' ');
      
      if (!queryText) return null;
      
      console.log(`   📝 Vector search query: "${queryText}"`);
      
      // Generate embedding
      const embeddingResponse = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: queryText
      });
      
      const queryEmbedding = embeddingResponse.data[0].embedding;
      
      // Search for similar contacts
      const vectorMatches = await db.execute(sql`
        WITH params AS (
          SELECT CAST(${JSON.stringify(queryEmbedding)}::text AS vector(1536)) AS q
        )
        SELECT
          c.id, c.name, c.email, c.phone,
          1 - (c.contact_embedding <=> p.q) AS cosine_sim
        FROM contacts c, params p
        WHERE c.contact_embedding IS NOT NULL
          AND c.inactive = false
          AND (1 - (c.contact_embedding <=> p.q)) > 0.85
        ORDER BY c.contact_embedding <=> p.q
        LIMIT 1
      `);
      
      if (vectorMatches.rows.length > 0) {
        const match = vectorMatches.rows[0];
        console.log(`   ✅ VECTOR MATCH: Found contact with similarity ${match.cosine_sim}`);
        
        // Look up the full contact data from cache
        const fullContact = this.contactsCache.get((match.email as string || '').toLowerCase());
        
        const response: ValidatedContact = {
          name: match.name as string || '',
          email: match.email as string || '',
          phone: match.phone as string || '',
          role: 'Unknown',
          matched_contact_id: match.id as string,
          match_method: 'VECTOR_SEARCH',
          confidence: parseFloat(match.cosine_sim as string),
          evidence: [`Vector similarity: ${(parseFloat(match.cosine_sim as string) * 100).toFixed(1)}%`],
          verified: true
        };
        
        // Add associated customer info if available
        if (fullContact && (fullContact.customer_number || fullContact.company_name)) {
          response.associated_customer = {
            customer_number: fullContact.customer_number || '',
            company_name: fullContact.company_name || fullContact.company || ''
          };
          console.log(`   └─ Associated Customer: ${response.associated_customer.company_name} (${response.associated_customer.customer_number})`);
        }
        
        return response;
      }
      
      return null;
    } catch (error) {
      console.error('Vector search failed:', error);
      return null;
    }
  }

  private fallbackContactResolution(input: ContactInput): ValidatedContact {
    // Simple fallback logic when OpenAI fails
    if (input.senderEmail) {
      const contact = this.contactsCache.get(input.senderEmail.toLowerCase());
      if (contact) {
        return {
          name: contact.name || '',
          email: contact.email,
          phone: contact.phones?.[0] || '',
          role: contact.role || 'Unknown',
          matched_contact_id: contact.id,
          match_method: 'SENDER_EMAIL_EXACT',
          confidence: 0.95,
          evidence: ['Fallback: exact email match']
        };
      }
    }

    return {
      name: input.senderName || '',
      email: input.senderEmail || '',
      phone: '',
      role: 'Unknown',
      matched_contact_id: '',
      match_method: 'UNKNOWN',
      confidence: 0.1,
      evidence: ['Fallback: basic sender info']
    };
  }

  async validateContact(input: ContactInput): Promise<ValidatedContact> {
    console.log(`🔍 OPENAI CONTACT VALIDATOR: Processing contact resolution...`);
    console.log(`   └─ Sender: ${input.senderName || 'N/A'} <${input.senderEmail || 'N/A'}>`);
    
    try {
      // Load cache first
      await this.loadCaches();
      
      // STEP 1: Check for exact email match in DB first (hybrid approach)
      const extractedEmail = input.extractedData?.purchaseOrder?.contact?.email || 
                           input.extractedData?.purchaseOrder?.customer?.email ||
                           input.senderEmail;
                           
      if (extractedEmail) {
        const exactContact = this.contactsCache.get(extractedEmail.toLowerCase());
        if (exactContact && !exactContact.inactive) {
          console.log(`   ✅ EXACT DB MATCH: Found contact by email`);
          
          // Build response with verified data
          const response: ValidatedContact = {
            name: exactContact.name || '',
            email: exactContact.email || '',
            phone: exactContact.phone || exactContact.office_phone || '',
            role: 'Unknown',
            matched_contact_id: exactContact.id,
            match_method: 'SENDER_EMAIL_EXACT',
            confidence: 0.95,
            evidence: ['Exact email match in database'],
            verified: true
          };
          
          // Add associated customer info if available
          if (exactContact.customer_number || exactContact.company_name) {
            response.associated_customer = {
              customer_number: exactContact.customer_number || '',
              company_name: exactContact.company_name || exactContact.company || ''
            };
            console.log(`   └─ Associated Customer: ${response.associated_customer.company_name} (${response.associated_customer.customer_number})`);
          }
          
          return response;
        }
      }
      
      // STEP 2: Check by sender email if different
      if (input.senderEmail && input.senderEmail !== extractedEmail) {
        const senderContact = this.contactsCache.get(input.senderEmail.toLowerCase());
        if (senderContact && !senderContact.inactive) {
          console.log(`   ✅ SENDER EMAIL MATCH: Found contact by sender email`);
          
          const response: ValidatedContact = {
            name: senderContact.name || '',
            email: senderContact.email || '',
            phone: senderContact.phone || senderContact.office_phone || '',
            role: 'Unknown',
            matched_contact_id: senderContact.id,
            match_method: 'SENDER_EMAIL_EXACT',
            confidence: 0.90,
            evidence: ['Sender email match in database'],
            verified: true
          };
          
          // Add associated customer info if available
          if (senderContact.customer_number || senderContact.company_name) {
            response.associated_customer = {
              customer_number: senderContact.customer_number || '',
              company_name: senderContact.company_name || senderContact.company || ''
            };
            console.log(`   └─ Associated Customer: ${response.associated_customer.company_name} (${response.associated_customer.customer_number})`);
          }
          
          return response;
        }
      }
      
      // STEP 3: Try vector search before AI
      console.log(`   🔮 No exact DB match, trying vector search...`);
      const vectorMatch = await this.vectorSearchContact(input);
      if (vectorMatch) {
        return vectorMatch;
      }
      
      // STEP 4: If no vector match, then use AI validation
      console.log(`   🤖 No vector match, proceeding to AI validation...`);
      const validatedContact = await this.validateWithOpenAI(input);
      
      console.log(`✅ Contact validated: ${validatedContact.name} <${validatedContact.email}>`);
      console.log(`   └─ Method: ${validatedContact.match_method} (Confidence: ${validatedContact.confidence})`);
      console.log(`   └─ Role: ${validatedContact.role}`);
      console.log(`   └─ Evidence: ${validatedContact.evidence.join(', ')}`);
      
      return validatedContact;
    } catch (error) {
      console.error('Contact validation failed:', error);
      throw error;
    }
  }
}