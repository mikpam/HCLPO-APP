import { GoogleGenAI } from "@google/genai";

// DON'T DELETE THIS COMMENT
// Follow these instructions when using this blueprint:
// - Note that the newest Gemini model series is "gemini-2.5-flash" or gemini-2.5-pro"
//   - do not change this unless explicitly requested by the user

// This API key is from Gemini Developer API Key, not vertex AI API Key
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
  attachments_present: boolean;
  body_sufficiency: boolean;
  sample_flag: boolean;
  confidence: number;
  artwork_only: boolean;
}

export interface ClassificationResult {
  analysis_flags: ClassificationFlags;
  recommended_route: "TEXT_PO" | "ATTACHMENT_PO" | "REVIEW";
  tags: string[];
}

export class GeminiService {
  private ai = ai;

  private isArtworkFile(filename: string, contentType: string): boolean {
    const artworkExtensions = ['.ai', '.eps', '.svg', '.png', '.jpg', '.jpeg', '.tif', '.gif'];
    const artworkMimeTypes = ['application/postscript', 'image/', 'application/illustrator'];
    
    const hasArtworkExtension = artworkExtensions.some(ext => 
      filename.toLowerCase().endsWith(ext)
    );
    
    const hasArtworkMimeType = artworkMimeTypes.some(mime => 
      contentType.toLowerCase().includes(mime)
    );
    
    return hasArtworkExtension || hasArtworkMimeType;
  }

  private checkBodySufficiency(body: string): boolean {
    const hasQuantities = /\b\d+\s*(pcs?|pieces?|units?|qty|quantity)\b/i.test(body);
    const hasPricing = /\$\d+|\d+\.\d{2}|total|price|cost/i.test(body);
    const hasItems = /item|product|description|part|sku/i.test(body);
    
    return hasQuantities && hasPricing && hasItems;
  }

  async classifyEmail(input: EmailClassificationInput): Promise<ClassificationResult> {
    try {
      // Pre-filter artwork files
      const nonArtworkAttachments = input.attachments.filter(att => 
        !this.isArtworkFile(att.filename, att.contentType)
      );

      const artworkOnly = input.attachments.length > 0 && nonArtworkAttachments.length === 0;
      const attachmentsPresent = input.attachments.length > 0;
      const bodySufficiency = this.checkBodySufficiency(input.body);

      const systemPrompt = `You are an expert email classifier for purchase orders. Analyze the email and classify:

ROUTES:
- TEXT_PO: Purchase order info is in email body (sufficient data)
- ATTACHMENT_PO: Purchase order is in PDF attachment 
- REVIEW: Requires manual review (samples, unclear, missing info)

Return JSON with analysis flags:
{
  "analysis_flags": {
    "attachments_present": boolean,
    "body_sufficiency": boolean, 
    "sample_flag": boolean,
    "confidence": 0.0-1.0,
    "artwork_only": boolean
  },
  "recommended_route": "TEXT_PO|ATTACHMENT_PO|REVIEW",
  "tags": ["tag1", "tag2"]
}`;

      const prompt = `Subject: ${input.subject}
Sender: ${input.sender}
Body: ${input.body}
Attachments: ${input.attachments.map(a => a.filename).join(', ')}

Classify this email:`;

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              analysis_flags: {
                type: "object",
                properties: {
                  attachments_present: { type: "boolean" },
                  body_sufficiency: { type: "boolean" },
                  sample_flag: { type: "boolean" },
                  confidence: { type: "number" },
                  artwork_only: { type: "boolean" }
                }
              },
              recommended_route: { type: "string", enum: ["TEXT_PO", "ATTACHMENT_PO", "REVIEW"] },
              tags: { type: "array", items: { type: "string" } }
            }
          }
        },
        contents: prompt,
      });

      const rawJson = response.text;
      if (rawJson) {
        const result: ClassificationResult = JSON.parse(rawJson);
        
        // Override with our computed values
        result.analysis_flags.attachments_present = attachmentsPresent;
        result.analysis_flags.body_sufficiency = bodySufficiency;
        result.analysis_flags.artwork_only = artworkOnly;
        
        return result;
      } else {
        throw new Error("Empty response from Gemini");
      }
    } catch (error) {
      console.error('Gemini classification error:', error);
      // Fallback classification
      return {
        analysis_flags: {
          attachments_present: input.attachments.length > 0,
          body_sufficiency: this.checkBodySufficiency(input.body),
          sample_flag: false,
          confidence: 0.1,
          artwork_only: false
        },
        recommended_route: input.attachments.length > 0 ? 'ATTACHMENT_PO' : 'REVIEW',
        tags: ['fallback']
      };
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

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          systemInstruction: "You are a data extraction expert. Extract purchase order information and return structured JSON.",
          responseMimeType: "application/json"
        },
        contents: prompt,
      });

      const rawJson = response.text;
      if (rawJson) {
        return JSON.parse(rawJson);
      } else {
        throw new Error("Empty response from Gemini");
      }
    } catch (error) {
      console.error('Gemini extraction error:', error);
      throw new Error(`Data extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }



  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Respond with 'OK' to test the connection.",
      });

      if (response.text === 'OK') {
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

export const geminiService = new GeminiService();