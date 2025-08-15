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

  async classifyEmail(input: EmailClassificationInput): Promise<ClassificationResult & { engine: AIEngine }> {
    try {
      const service = this.getService(this.classificationEngine);
      const result = await service.classifyEmail(input);
      return { ...result, engine: this.classificationEngine };
    } catch (error) {
      console.error(`${this.classificationEngine} classification failed, trying fallback:`, error);
      
      try {
        const fallbackService = this.getService(this.fallbackEngine);
        const result = await fallbackService.classifyEmail(input);
        return { ...result, engine: this.fallbackEngine };
      } catch (fallbackError) {
        console.error(`Both AI engines failed for classification:`, fallbackError);
        
        // Ultimate fallback
        return {
          analysis_flags: {
            attachments_present: input.attachments.length > 0,
            body_sufficiency: false,
            sample_flag: false,
            confidence: 0.1,
            artwork_only: false
          },
          recommended_route: input.attachments.length > 0 ? 'ATTACHMENT_PO' : 'REVIEW',
          tags: ['fallback'],
          engine: this.classificationEngine
        };
      }
    }
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