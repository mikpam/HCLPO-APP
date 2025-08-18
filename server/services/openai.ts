import OpenAI from "openai";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || ""
});

export interface EmailClassificationInput {
  sender: string;
  subject: string;
  body: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
}

export interface ClassificationFlags {
  has_attachments: boolean;
  attachments_all_artwork_files: boolean;
  po_details_in_body_sufficient: boolean;
  is_sample_request_in_body: boolean;
  overall_po_nature_probability: "high" | "medium" | "low";
  confidence_score: number;
}

export interface ClassificationResult {
  analysis_flags: ClassificationFlags;
  recommended_route: "TEXT_PO" | "TEXT_SAMPLE" | "ATTACHMENT_PO" | "ATTACHMENT_SAMPLE" | "REVIEW";
  suggested_tags: string[];
}

export class OpenAIService {

  // AI-powered attachment content analysis to determine if it's a legitimate PO document
  async analyzeAttachmentContent(filename: string, contentType: string): Promise<{
    isPurchaseOrder: boolean;
    isArtwork: boolean;
    confidence: number;
    reason: string;
  }> {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system", 
            content: `You are an AI document classifier. Analyze the filename and content type to determine if this is a legitimate purchase order document vs artwork/proof files.

PURCHASE ORDER indicators:
- Filenames containing: po, order, purchase, quote, invoice, proposal
- File types: PDF, Word docs, Excel files  
- Business document patterns

ARTWORK/PROOF indicators:
- Image files (PNG, JPG, AI, EPS, SVG)
- Filenames like: artwork, logo, proof, design, image001.png
- Generic image patterns

Return JSON with:
- isPurchaseOrder: boolean
- isArtwork: boolean  
- confidence: number (0-1)
- reason: string explanation`
          },
          {
            role: "user",
            content: `Analyze this attachment:
Filename: ${filename}
Content Type: ${contentType}

Classify as purchase order document or artwork/proof file.`
          }
        ],
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      return {
        isPurchaseOrder: result.isPurchaseOrder || false,
        isArtwork: result.isArtwork || false,
        confidence: result.confidence || 0.5,
        reason: result.reason || 'Analysis completed'
      };
    } catch (error) {
      console.error('Attachment analysis error:', error);
      // Fallback to pattern matching
      return {
        isPurchaseOrder: this.isAttachmentPO(filename, contentType),
        isArtwork: this.isArtworkFile(filename, contentType),
        confidence: 0.6,
        reason: 'Fallback pattern matching'
      };
    }
  }

  private isArtworkFile(filename: string, contentType: string): boolean {
    const artworkExtensions = ['.ai', '.eps', '.svg', '.png', '.jpg', '.jpeg', '.tif', '.gif', '.bmp', '.psd'];
    const artworkMimeTypes = ['image/', 'application/illustrator', 'application/postscript', 'application/eps'];
    
    // Common artwork filename patterns
    const artworkPatterns = [
      /^(artwork|logo|proof|design|image\d*)\./i,
      /\b(logo|artwork|proof|design)\b.*\.(png|jpg|jpeg|ai|eps|svg)$/i,
      /^image\d+\.(png|jpg|jpeg)$/i  // Generic image files like image001.png
    ];
    
    const hasArtworkExtension = artworkExtensions.some(ext => 
      filename.toLowerCase().endsWith(ext)
    );
    
    const hasArtworkMimeType = artworkMimeTypes.some(mime => 
      contentType.toLowerCase().includes(mime)
    );
    
    const hasArtworkPattern = artworkPatterns.some(pattern => 
      pattern.test(filename)
    );
    
    return hasArtworkExtension || hasArtworkMimeType || hasArtworkPattern;
  }

  private checkPODetailsInBody(body: string): boolean {
    // Check for item descriptions AND explicit quantities AND total/price figures
    const hasQuantities = /\b\d+\s*(pcs?|pieces?|units?|qty|quantity)\b/i.test(body);
    const hasPricing = /\$\d+|\d+\.\d{2}|total|price|cost/i.test(body);
    const hasItems = /item|product|description|part|sku/i.test(body);
    
    return hasQuantities && hasPricing && hasItems;
  }

  private extractTotalQuantity(body: string): number {
    const quantityMatches = body.match(/\b(\d+)\s*(pcs?|pieces?|units?|qty|quantity)\b/gi);
    if (!quantityMatches) return 0;
    
    return quantityMatches.reduce((total, match) => {
      const num = parseInt(match.match(/\d+/)?.[0] || '0');
      return total + num;
    }, 0);
  }

  private assessPONature(subject: string, body: string): "high" | "medium" | "low" {
    const poKeywords = /purchase.?order|po\s|order|quote|rfq|requisition/i;
    const sampleKeywords = /sample|proof|test|trial/i;
    
    if (poKeywords.test(subject) || poKeywords.test(body)) {
      return "high";
    } else if (sampleKeywords.test(subject) || sampleKeywords.test(body)) {
      return "medium";
    }
    return "low";
  }

  private isAttachmentPO(filename: string, contentType: string): boolean {
    const poPattern = /^(po|order|purchase).*\.(pdf|docx?|xlsx?)$/i;
    const poMimeTypes = /application\/(pdf|msword|vnd\.openxmlformats-officedocument.*)/;
    
    // Enhanced PO filename patterns
    const commonPOPatterns = [
      /\bpo\b.*\.(pdf|docx?|xlsx?)$/i,
      /\border\b.*\.(pdf|docx?|xlsx?)$/i,  
      /\bpurchase\b.*\.(pdf|docx?|xlsx?)$/i,
      /\b(invoice|quote|proposal)\b.*\.(pdf|docx?|xlsx?)$/i
    ];
    
    const hasPOPattern = commonPOPatterns.some(pattern => pattern.test(filename));
    const hasPOMimeType = poMimeTypes.test(contentType);
    
    return hasPOPattern || hasPOMimeType;
  }

  // Truncate email body to prevent token limit issues
  private truncateEmailBody(body: string, maxChars: number = 10000): string {
    if (body.length <= maxChars) {
      return body;
    }
    
    // Keep the beginning of the email (most important content)
    const truncated = body.substring(0, maxChars);
    
    // Try to end at a complete sentence to maintain context
    const lastSentence = truncated.lastIndexOf('.');
    const lastNewline = truncated.lastIndexOf('\n');
    const cutPoint = Math.max(lastSentence, lastNewline);
    
    if (cutPoint > maxChars * 0.8) { // If we can find a good break point
      return truncated.substring(0, cutPoint + 1) + '\n\n[... content truncated for processing ...]';
    }
    
    return truncated + '\n\n[... content truncated for processing ...]';
  }

  async preProcessEmail(input: EmailClassificationInput): Promise<{
    response: string;
    score: string;
    shouldProceed: boolean;
  }> {
    try {
      // Build attachment filenames string
      const attachmentFilenames = input.attachments?.map(a => a.filename).join(', ') || '';
      
      // Truncate email body to prevent token limit issues
      const truncatedBody = this.truncateEmailBody(input.body);
      
      console.log(`📊 EMAIL SIZE: Original body ${input.body.length} chars, truncated to ${truncatedBody.length} chars`);

      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          {
            role: "user",
            content: `Analyze the email with subject ${input.subject} and body text ${truncatedBody} and attachments file name: ${attachmentFilenames} . Determine its intent based on the following detailed options:

Purchase Order: The email includes a new order for product items (typically 10 or more) with details such as billing, delivery, or payment information. If the email is part of a follow-up but clearly includes new purchase order details, classify it as a Purchase Order.
Sample Request: The email requests product samples, typically for quantities less than 10 items for evaluation purposes.
Rush Order: The email communicates urgency, indicating that the order should be processed and delivered as quickly as possible.
Follow Up: The email is a continuation of previous communication regarding an order or inquiry and does not introduce new order details. If the email references a previous purchase order without including new purchase order details, classify it as a Follow Up.
None of these: The email does not match any of the above categories.

Provide your answer as a JSON object with two keys:

"response": containing one of the options exactly as listed above.
"score": containing a simulated confidence score (derived from log probabilities) expressed as a percentage (with 100% being the highest).

**Crucially, your ENTIRE output MUST be a valid JSON object. Nothing else. No surrounding text, no explanations, no backticks, no markdown, no "json" label. Just the JSON. For example:**

{
  "response": "Purchase Order",
  "score": "87%"
}`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 1,
      });

      const rawJson = response.choices[0].message.content;
      if (rawJson) {
        const result = JSON.parse(rawJson);
        
        // Only proceed with detailed classification for Purchase Order, Sample Request, and Rush Order
        const shouldProceed = ['Purchase Order', 'Sample Request', 'Rush Order'].includes(result.response);
        
        return {
          response: result.response,
          score: result.score,
          shouldProceed
        };
      } else {
        throw new Error("Empty response from OpenAI");
      }
    } catch (error) {
      console.error('OpenAI pre-processing error:', error);
      throw new Error(`Email pre-processing failed: ${error}`);
    }
  }

  async classifyEmail(input: EmailClassificationInput): Promise<ClassificationResult> {
    try {
      // Build attachment info strings
      const attachmentFilenames = input.attachments?.map(a => a.filename).join(', ') || '';
      const attachmentContentTypes = input.attachments?.map(a => a.contentType).join(', ') || '';

      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          {
            role: "system",
            content: `You are an **Email Analysis Assistant**. Inspect the email fields and return a single, valid JSON object deciding:

1. Whether the order data should come from **body text** or **attachments**  
2. Whether it is a **regular PO** or a **sample request**

### TASKS
1. **Attachment Presence** – Detect any attachment.  
2. **Artwork‑Only Attachments** – If attachments exist, decide if **all** are artwork / proof files  
   (filename ends in \`.ai|.eps|.svg|.png|.jpg|.jpeg|.tif|.gif\` **or** contentType matches \`image/.*\` or \`application/(illustrator|postscript|eps)\`).  
   **CRITICAL**: Be very conservative - only mark as artwork-only if 100% certain ALL attachments are purely graphics/art files.
3. **PO Details in Body** – Decide if the body alone supplies enough structured info to act as a purchase order  
   (item descriptions **and** explicit quantities **and** total / price figures).
4. **Sample Request in Body** – If Task 3 is true, check whether the **sum of all explicit quantities mentioned** is **< 5**.
5. **Overall PO Nature** – Assess how likely the email's main intent is a new, transactable PO (including sample requests).
6. **Recommended Route** (CHECK IN THIS EXACT ORDER - ATTACHMENTS ALWAYS WIN!)  
   * **"ATTACHMENT_PO"** – **ABSOLUTE FIRST PRIORITY**: use if \`has_attachments\` is \`true\` **and** \`is_sample_request_in_body\` is \`false\`. **IGNORE artwork detection - ANY attachment goes to ATTACHMENT_PO!**  
   * **"ATTACHMENT_SAMPLE"** – use if \`has_attachments\` is \`true\` **and** \`is_sample_request_in_body\` is \`true\`. **IGNORE artwork detection - ANY attachment with sample goes to ATTACHMENT_SAMPLE!**  
   * **"TEXT_PO"** – use **ONLY** if \`has_attachments\` is \`false\` **and** \`po_details_in_body_sufficient\` is \`true\` **and** \`is_sample_request_in_body\` is \`false\`.  
   * **"TEXT_SAMPLE"** – use **ONLY** if \`has_attachments\` is \`false\` **and** \`is_sample_request_in_body\` is \`true\` **and** \`po_details_in_body_sufficient\` is \`true\`.  
   * **"REVIEW"** – use for all other cases (ambiguous or low PO intent).

### JSON SCHEMA (STRICT)
{
  "analysis_flags": {
    "has_attachments": boolean,
    "attachments_all_artwork_files": boolean,
    "po_details_in_body_sufficient": boolean,
    "is_sample_request_in_body": boolean,
    "overall_po_nature_probability": "high" | "medium" | "low",
    "confidence_score": number        // float 0‑1
  },
  "recommended_route": "TEXT_PO" | "TEXT_SAMPLE" | "ATTACHMENT_PO" | "ATTACHMENT_SAMPLE" | "REVIEW",
  "suggested_tags": [string]           // only from the Allowed Tag List
}

### ALLOWED TAG LIST & CONDITIONS
* **"Purchase Order Related"** – include if "overall_po_nature_probability" is "high" or "medium".
* **"PO in Body"** – include if "po_details_in_body_sufficient" is true.
* **"Sample Request in Body"** – include if both "is_sample_request_in_body" and "po_details_in_body_sufficient" are true.
* **"Attachment Likely PO"** – include if "has_attachments" is true **and not** "attachments_all_artwork_files"  
  **and** any filename matches \`(?i)^(po|order).*\\.(pdf|docx?|xlsx?)$\` **or** contentType matches \`application/(pdf|msword|vnd\\.openxmlformats-officedocument.*)\`.
* **"Artwork Attachment"** – include if "attachments_all_artwork_files" is true.
* **"Needs Attachment Review"** – include if "recommended_route" is "REVIEW".
* **"Low PO Intent"** – include if "overall_po_nature_probability" is "low".

OUTPUT RULES
* Return **only** the JSON object—no commentary, markdown, or extra text.  
* **If you cannot comply exactly**, output the single word \`INVALID\`.`
          },
          {
            role: "user", 
            content: `INPUT FIELDS
* Subject: "${input.subject}"
* Body Text: "${this.truncateEmailBody(input.body)}"
* Sender Name: "${input.sender}"
* Sender Email: "${input.sender}"
* Attachment Filenames: "${attachmentFilenames}"
* Attachment Content Types: "${attachmentContentTypes}"

BEGIN JSON OUTPUT NOW:`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      // Extract base values
      const hasAttachments = result.analysis_flags?.has_attachments || (input.attachments && input.attachments.length > 0);
      const isSampleRequest = result.analysis_flags?.is_sample_request_in_body || false;
      let recommendedRoute = result.recommended_route || 'REVIEW';
      
      // CRITICAL ROUTING OVERRIDE: If attachments exist, force ATTACHMENT routes
      if (hasAttachments) {
        if (isSampleRequest) {
          recommendedRoute = 'ATTACHMENT_SAMPLE';
          console.log(`🔧 ROUTING OVERRIDE: Has attachments + sample request → ATTACHMENT_SAMPLE`);
        } else {
          recommendedRoute = 'ATTACHMENT_PO';
          console.log(`🔧 ROUTING OVERRIDE: Has attachments + not sample → ATTACHMENT_PO`);
        }
      }
      
      // Validate and return the exact response structure
      return {
        analysis_flags: {
          has_attachments: hasAttachments,
          attachments_all_artwork_files: result.analysis_flags?.attachments_all_artwork_files || false,
          po_details_in_body_sufficient: result.analysis_flags?.po_details_in_body_sufficient || false,
          is_sample_request_in_body: isSampleRequest,
          overall_po_nature_probability: result.analysis_flags?.overall_po_nature_probability || "low",
          confidence_score: result.analysis_flags?.confidence_score || 0.5
        },
        recommended_route: recommendedRoute,
        suggested_tags: result.suggested_tags || []
      };
    } catch (error) {
      console.error('OpenAI classification error:', error);
      throw new Error(`Email classification failed: ${error}`);
    }
  }

  async extractPOData(body: string, attachmentText?: string): Promise<any> {
    try {
      const sourceText = attachmentText || body;
      
      const prompt = `
        Extract purchase order data from the following text and structure it as JSON:

        ${sourceText}

        Extract the following information:
        - PO number
        - Customer information (name, email, address)
        - Line items (description, quantity, price, SKU if available)
        - Shipping information
        - Totals
        - Dates

        Respond with structured JSON containing this information.
      `;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a data extraction expert. Extract purchase order information and return structured JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1
      });

      return JSON.parse(response.choices[0].message.content || '{}');

    } catch (error) {
      console.error('OpenAI extraction error:', error);
      throw new Error(`Data extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Respond with 'OK' to test the connection." }],
        max_tokens: 10,
      });

      if (response.choices[0]?.message?.content?.includes('OK')) {
        return { success: true };
      }
      return { success: false, error: 'Unexpected response' };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Connection test failed' 
      };
    }
  }
}

export const openaiService = new OpenAIService();
