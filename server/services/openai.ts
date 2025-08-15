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
      // Pre-filter artwork files
      const nonArtworkAttachments = input.attachments.filter(att => 
        !this.isArtworkFile(att.filename, att.contentType)
      );

      const artworkOnly = input.attachments.length > 0 && nonArtworkAttachments.length === 0;
      const attachmentsPresent = nonArtworkAttachments.length > 0;
      const bodySufficiency = this.checkBodySufficiency(input.body);
      const totalQuantity = this.extractTotalQuantity(input.body);
      
      const prompt = `
        Analyze this email to determine if it contains a purchase order and classify the routing:

        From: ${input.sender}
        Subject: ${input.subject}
        Body: ${input.body}
        Attachments: ${input.attachments.map(a => `${a.filename} (${a.contentType})`).join(', ')}

        Classification Rules:
        1. TEXT_PO: If PO details are sufficiently present in email body (items, quantities, pricing)
        2. ATTACHMENT_PO: If PO is primarily in attachments (non-artwork files)
        3. REVIEW: If uncertain, low confidence, or potential sample order

        Additional Context:
        - Artwork files (.ai/.eps/.svg/.png/.jpg/.jpeg/.tif/.gif) should be ignored for PO classification
        - Small quantities (<5 total items) may indicate sample orders
        - Body sufficiency requires item descriptions + quantities + pricing information

        Respond with JSON in this exact format:
        {
          "analysis_flags": {
            "attachments_present": boolean,
            "body_sufficiency": boolean,
            "sample_flag": boolean,
            "confidence": number (0-1),
            "artwork_only": boolean
          },
          "recommended_route": "TEXT_PO" | "ATTACHMENT_PO" | "REVIEW",
          "tags": ["tag1", "tag2"]
        }
      `;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an expert email classifier for purchase order processing. Analyze emails and provide structured classification results."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      // Apply business rules overrides
      if (artworkOnly) {
        result.analysis_flags.artwork_only = true;
        result.recommended_route = "REVIEW";
        result.analysis_flags.confidence = Math.min(result.analysis_flags.confidence, 0.3);
      }

      if (totalQuantity > 0 && totalQuantity < 5) {
        result.analysis_flags.sample_flag = true;
        if (result.recommended_route === "TEXT_PO") {
          result.recommended_route = "REVIEW";
        }
      }

      // Override flags with our pre-computed values
      result.analysis_flags.attachments_present = attachmentsPresent;
      result.analysis_flags.body_sufficiency = bodySufficiency;
      result.analysis_flags.artwork_only = artworkOnly;

      return result;

    } catch (error) {
      console.error('OpenAI classification error:', error);
      throw new Error(`Classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
