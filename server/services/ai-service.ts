import { openaiService, type EmailClassificationInput, type ClassificationResult } from './openai.js';
import { geminiService } from './gemini.js';

export type AIEngine = 'openai' | 'gemini';
export type { EmailClassificationInput, ClassificationResult };

class AIServiceManager {
  private classificationEngine: AIEngine = 'openai'; // Default to OpenAI for classification
  private extractionEngine: AIEngine = 'openai'; // Default to OpenAI for text extraction  
  private attachmentEngine: AIEngine = 'gemini'; // Use Gemini 2.5 Pro for attachments
  private fallbackEngine: AIEngine = 'gemini';

  setEngine(engine: AIEngine) {
    this.classificationEngine = engine;
    this.extractionEngine = engine;
    this.fallbackEngine = engine === 'openai' ? 'gemini' : 'openai';
  }

  setAttachmentEngine(engine: AIEngine) {
    this.attachmentEngine = engine;
  }

  getCurrentEngine(): AIEngine {
    return this.classificationEngine;
  }

  getAttachmentEngine(): AIEngine {
    return this.attachmentEngine;
  }

  private getService(engine: AIEngine) {
    return engine === 'openai' ? openaiService : geminiService;
  }

  async processEmail(input: EmailClassificationInput): Promise<{
    preprocessing: { response: string; score: string; shouldProceed: boolean };
    classification?: ClassificationResult & { engine: AIEngine };
  }> {
    // Step 1: Pre-processing - Simple intent classification
    const preprocessing = await openaiService.preProcessEmail(input);
    
    // Step 2: Only proceed with detailed classification for Purchase Order, Sample Request, Rush Order
    if (!preprocessing.shouldProceed) {
      console.log(`Email classified as "${preprocessing.response}" - skipping detailed analysis`);
      return { preprocessing };
    }
    
    // Step 2: Detailed classification for qualified emails
    try {
      const classification = await openaiService.classifyEmail(input);
      return {
        preprocessing,
        classification: { ...classification, engine: 'openai' as AIEngine }
      };
    } catch (error) {
      console.error('OpenAI detailed classification failed:', error);
      
      // Fallback classification
      return {
        preprocessing,
        classification: {
          analysis_flags: {
            has_attachments: input.attachments.length > 0,
            attachments_all_artwork_files: false,
            po_details_in_body_sufficient: false,
            is_sample_request_in_body: false,
            overall_po_nature_probability: "low",
            confidence_score: 0.1
          },
          recommended_route: input.attachments.length > 0 ? 'ATTACHMENT_PO' : 'REVIEW',
          suggested_tags: ['OpenAI Service Unavailable'],
          engine: 'openai' as AIEngine
        }
      };
    }
  }

  // Kept for backward compatibility
  async classifyEmail(input: EmailClassificationInput): Promise<ClassificationResult & { engine: AIEngine }> {
    const result = await this.processEmail(input);
    return result.classification || {
      analysis_flags: {
        has_attachments: input.attachments.length > 0,
        attachments_all_artwork_files: false,
        po_details_in_body_sufficient: false,
        is_sample_request_in_body: false,
        overall_po_nature_probability: "low",
        confidence_score: 0.1
      },
      recommended_route: 'REVIEW',
      suggested_tags: [`Filtered out: ${result.preprocessing.response}`],
      engine: 'openai' as AIEngine
    };
  }

  async extractPOData(body: string, attachmentText?: string): Promise<any & { engine: AIEngine }> {
    // Use Gemini 2.5 Pro specifically for PDF attachment extraction
    const engine = attachmentText ? this.attachmentEngine : this.extractionEngine;
    
    try {
      const service = this.getService(engine);
      const result = await service.extractPOData(body, attachmentText);
      console.log(`Successfully extracted PO data using ${engine}${attachmentText ? ' (PDF attachment)' : ' (email body)'}`);
      return { ...result, engine };
    } catch (error) {
      console.error(`${engine} extraction failed, trying fallback:`, error);
      
      try {
        const fallbackService = this.getService(this.fallbackEngine);
        const result = await fallbackService.extractPOData(body, attachmentText);
        return { ...result, engine: this.fallbackEngine };
      } catch (fallbackError) {
        console.error(`Both AI engines failed for PO extraction:`, fallbackError);
        throw new Error(`All AI engines failed: ${fallbackError}`);
      }
    }
  }

  // PDF analysis is handled via extractPOData with attachmentText
  async analyzePDFContent(pdfText: string): Promise<any & { engine: AIEngine }> {
    return this.extractPOData("", pdfText);
  }

  async testConnections(): Promise<{
    openai: { success: boolean; error?: string };
    gemini: { success: boolean; error?: string };
    current: AIEngine;
  }> {
    const [openaiResult, geminiResult] = await Promise.all([
      openaiService.testConnection(),
      geminiService.testConnection()
    ]);

    return {
      openai: openaiResult,
      gemini: geminiResult,
      current: this.getCurrentEngine()
    };
  }

  getAvailableEngines(): { engine: AIEngine; available: boolean }[] {
    return [
      { 
        engine: 'openai', 
        available: !!process.env.OPENAI_API_KEY 
      },
      { 
        engine: 'gemini', 
        available: !!process.env.GEMINI_API_KEY 
      }
    ];
  }

  getEngineConfiguration() {
    return {
      classification: this.classificationEngine,
      extraction: this.extractionEngine,
      attachment: this.attachmentEngine,
      fallback: this.fallbackEngine,
      available: this.getAvailableEngines()
    };
  }
}

export const aiService = new AIServiceManager();