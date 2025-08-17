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
  match_method: 'EXTRACTED_JSON' | 'SENDER_EMAIL_EXACT' | 'SENDER_DOMAIN' | 'THREAD_PARTICIPANT' | 'CUSTOMER_DEFAULT' | 'FUZZY_NAME' | 'SIG_PARSE' | 'UNKNOWN';
  confidence: number;
  evidence: string[];
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
      // Load active contacts (inactive=false means active)
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

      // Load customers with domains
      const allCustomers = await db
        .select()
        .from(customers);
      
      this.customersCache.clear();
      for (const customer of allCustomers) {
        this.customersCache.set(customer.customerNumber, customer);
      }
      
      this.lastCacheUpdate = now;
      console.log(`   📞 Loaded ${this.contactsCache.size} contacts and ${this.customersCache.size} customers into cache`);
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