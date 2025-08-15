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
  private isArtworkFile(filename: string, contentType: string): boolean {
    const artworkExtensions = ['.ai', '.eps', '.svg', '.png', '.jpg', '.jpeg', '.tif', '.gif'];
    const artworkMimeTypes = ['image/', 'application/illustrator', 'application/postscript', 'application/eps'];
    
    const hasArtworkExtension = artworkExtensions.some(ext => 
      filename.toLowerCase().endsWith(ext)
    );
    
    const hasArtworkMimeType = artworkMimeTypes.some(mime => 
      contentType.toLowerCase().includes(mime)
    );
    
    return hasArtworkExtension || hasArtworkMimeType;
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
    const poPattern = /^(po|order).*\.(pdf|docx?|xlsx?)$/i;
    const poMimeTypes = /application\/(pdf|msword|vnd\.openxmlformats-officedocument.*)/;
    
    return poPattern.test(filename) || poMimeTypes.test(contentType);
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
3. **PO Details in Body** – Decide if the body alone supplies enough structured info to act as a purchase order  
   (item descriptions **and** explicit quantities **and** total / price figures).
4. **Sample Request in Body** – If Task 3 is true, check whether the **sum of all explicit quantities mentioned** is **< 5**.
5. **Overall PO Nature** – Assess how likely the email's main intent is a new, transactable PO (including sample requests).
6. **Recommended Route**  
   * **"TEXT_PO"** – use if \`po_details_in_body_sufficient\` is \`true\` **and not** \`is_sample_request_in_body\`  
     **and** (attachments are absent **or** artwork‑only **or** don't look like a PO).  
   * **"TEXT_SAMPLE"** – use if \`is_sample_request_in_body\` is \`true\` **and** \`po_details_in_body_sufficient\` is \`true\`.  
   * **"ATTACHMENT_PO"** – use if \`has_attachments\` is \`true\` **and not** \`attachments_all_artwork_files\`  
     **and** attachments look like a PO **and** \`is_sample_request_in_body\` is \`false\`.  
   * **"ATTACHMENT_SAMPLE"** – use if \`has_attachments\` is \`true\` **and not** \`attachments_all_artwork_files\`  
     **and** attachments look like a PO **and** \`is_sample_request_in_body\` is \`true\`.  
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
* Body Text: "${input.body}"
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
      
      // Validate and return the exact response structure
      return {
        analysis_flags: {
          has_attachments: result.analysis_flags?.has_attachments || false,
          attachments_all_artwork_files: result.analysis_flags?.attachments_all_artwork_files || false,
          po_details_in_body_sufficient: result.analysis_flags?.po_details_in_body_sufficient || false,
          is_sample_request_in_body: result.analysis_flags?.is_sample_request_in_body || false,
          overall_po_nature_probability: result.analysis_flags?.overall_po_nature_probability || "low",
          confidence_score: result.analysis_flags?.confidence_score || 0.5
        },
        recommended_route: result.recommended_route || 'REVIEW',
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
