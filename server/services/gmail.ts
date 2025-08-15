import { gmail_v1, google } from 'googleapis';
import { JWT } from 'google-auth-library';

export interface GmailMessage {
  id: string;
  sender: string;
  subject: string;
  body: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    data?: Buffer;
  }>;
  labels: string[];
  internalDate: string;
}

export class GmailService {
  private gmail: gmail_v1.Gmail;
  
  constructor() {
    const auth = new JWT({
      email: process.env.GMAIL_SERVICE_EMAIL,
      key: process.env.GMAIL_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.labels',
        'https://www.googleapis.com/auth/gmail.modify'
      ],
      // Impersonate the target Gmail account
      subject: 'hcl@metrixdigital.com'
    });

    this.gmail = google.gmail({ version: 'v1', auth });
  }

  async ensureLabelsExist(): Promise<void> {
    try {
      const labelsResponse = await this.gmail.users.labels.list({
        userId: 'me'
      });

      const existingLabels = labelsResponse.data.labels || [];
      const requiredLabels = [
        'purchase-order', 
        'unprocessed', 
        'processed',
        'filtered',
        // Preprocessing classification labels for auditing
        'ai-purchase-order',
        'ai-sample-request', 
        'ai-rush-order',
        'ai-follow-up',
        'ai-none-of-these'
      ];
      
      for (const labelName of requiredLabels) {
        const exists = existingLabels.some(label => label.name === labelName);
        if (!exists) {
          try {
            await this.gmail.users.labels.create({
              userId: 'me',
              requestBody: {
                name: labelName,
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show'
              }
            });
            console.log(`Created Gmail label: ${labelName}`);
          } catch (error: any) {
            // Label might already exist, ignore conflict errors
            if (error.code === 409) {
              console.log(`Gmail label '${labelName}' already exists`);
            } else {
              throw error;
            }
          }
        } else {
          console.log(`Gmail label '${labelName}' already exists`);
        }
      }
    } catch (error) {
      console.error('Error managing Gmail labels:', error);
      throw new Error(`Failed to manage labels: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getMessages(query: string = 'in:inbox'): Promise<GmailMessage[]> {
    try {
      const listResponse = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 50
      });

      const messageIds = listResponse.data.messages || [];
      const messages: GmailMessage[] = [];

      for (const messageRef of messageIds) {
        if (!messageRef.id) continue;
        
        const message = await this.gmail.users.messages.get({
          userId: 'me',
          id: messageRef.id,
          format: 'full'
        });

        const parsed = await this.parseMessage(message.data);
        if (parsed) {
          messages.push(parsed);
        }
      }

      return messages;
    } catch (error) {
      console.error('Gmail API error:', error);
      throw new Error(`Failed to fetch emails: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async parseMessage(message: gmail_v1.Schema$Message): Promise<GmailMessage | null> {
    try {
      if (!message.id || !message.payload) return null;

      const headers = message.payload.headers || [];
      const sender = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
      const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
      
      const body = this.extractBody(message.payload);
      const attachments = await this.extractAttachments(message.payload);
      const labels = message.labelIds || [];

      return {
        id: message.id,
        sender,
        subject,
        body,
        attachments,
        labels,
        internalDate: message.internalDate || new Date().getTime().toString()
      };
    } catch (error) {
      console.error('Error parsing message:', error);
      return null;
    }
  }

  private extractBody(payload: gmail_v1.Schema$MessagePart): string {
    let body = '';

    if (payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
          if (part.body?.data) {
            body += Buffer.from(part.body.data, 'base64').toString('utf-8');
          }
        } else if (part.parts) {
          body += this.extractBody(part);
        }
      }
    }

    return body;
  }

  async downloadAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    try {
      const attachment = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId
      });

      if (!attachment.data.data) {
        throw new Error('No attachment data found');
      }

      return Buffer.from(attachment.data.data, 'base64');
    } catch (error) {
      console.error('Error downloading attachment:', error);
      throw new Error(`Failed to download attachment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async extractAttachments(payload: gmail_v1.Schema$MessagePart): Promise<Array<{
    filename: string;
    contentType: string;
    size: number;
    attachmentId?: string;
    data?: Buffer;
  }>> {
    const attachments: Array<{
      filename: string;
      contentType: string;
      size: number;
      attachmentId?: string;
      data?: Buffer;
    }> = [];

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.filename && part.body?.attachmentId) {
          attachments.push({
            filename: part.filename,
            contentType: part.mimeType || 'application/octet-stream',
            size: part.body.size || 0,
            attachmentId: part.body.attachmentId,
          });
        }
        
        if (part.parts) {
          const subAttachments = await this.extractAttachments(part);
          attachments.push(...subAttachments);
        }
      }
    }

    return attachments;
  }

  private async getLabelId(labelName: string): Promise<string | null> {
    try {
      const labelsResponse = await this.gmail.users.labels.list({
        userId: 'me'
      });
      const label = labelsResponse.data.labels?.find(l => l.name === labelName);
      return label?.id || null;
    } catch (error) {
      console.error(`Error getting label ID for ${labelName}:`, error);
      return null;
    }
  }

  async markAsProcessed(messageId: string, preprocessingResult?: { shouldProceed: boolean; response: string }): Promise<void> {
    try {
      console.log(`Updating Gmail labels for message ${messageId}`);
      
      // Get label IDs (these should exist in the Gmail account)
      const unprocessedId = await this.getLabelId('unprocessed');
      
      let removeLabels: string[] = [];
      let addLabels: string[] = [];
      
      // Always remove 'unprocessed' label if it exists
      if (unprocessedId) {
        removeLabels.push(unprocessedId);
      }
      
      if (preprocessingResult) {
        // Add preprocessing classification label for auditing
        const classificationLabelMap: { [key: string]: string } = {
          'Purchase Order': 'ai-purchase-order',
          'Sample Request': 'ai-sample-request', 
          'Rush Order': 'ai-rush-order',
          'Follow Up': 'ai-follow-up',
          'None of these': 'ai-none-of-these'
        };
        
        const classificationLabel = classificationLabelMap[preprocessingResult.response];
        if (classificationLabel) {
          const classificationLabelId = await this.getLabelId(classificationLabel);
          if (classificationLabelId) {
            addLabels.push(classificationLabelId);
            console.log(`   └─ Adding '${classificationLabel}' label (AI classification: ${preprocessingResult.response})`);
          }
        }
        
        if (preprocessingResult.shouldProceed) {
          // Email passed preprocessing - will be processed further
          const processedId = await this.getLabelId('processed');
          if (processedId) {
            addLabels.push(processedId);
            console.log(`   └─ Adding 'processed' label (passed preprocessing: ${preprocessingResult.response})`);
          }
        } else {
          // Email was filtered out by preprocessing
          const filteredId = await this.getLabelId('filtered');
          if (filteredId) {
            addLabels.push(filteredId);
            console.log(`   └─ Adding 'filtered' label (blocked by preprocessing: ${preprocessingResult.response})`);
          }
        }
      } else {
        // Fallback - just mark as processed
        const processedId = await this.getLabelId('processed');
        if (processedId) {
          addLabels.push(processedId);
        }
      }
      
      // Apply label changes if we have any
      if (removeLabels.length > 0 || addLabels.length > 0) {
        await this.gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            ...(removeLabels.length > 0 && { removeLabelIds: removeLabels }),
            ...(addLabels.length > 0 && { addLabelIds: addLabels })
          }
        });
        console.log(`   ✅ Successfully updated Gmail labels`);
      } else {
        console.log(`   ⚠️  No label changes needed (labels may not exist in Gmail)`);
      }
      
    } catch (error) {
      console.error('   ❌ Error updating Gmail labels:', error);
      // Don't throw error - label updates shouldn't stop email processing
    }
  }

  async storeEmailAttachments(messageId: string, attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    attachmentId?: string;
  }>): Promise<Array<{ filename: string; storagePath: string; buffer?: Buffer }>> {
    const storedAttachments = [];
    
    console.log(`📎 ATTACHMENT ANALYSIS: Found ${attachments.length} total attachments`);
    
    for (const attachment of attachments) {
      console.log(`   └─ ${attachment.filename}: ${attachment.contentType} (${attachment.size} bytes) ${attachment.attachmentId ? '[Has ID]' : '[No ID]'}`);
      
      // Process all document types that Gemini can handle for PO extraction
      const isProcessableDocument = (
        // PDF documents
        attachment.contentType === 'application/pdf' || 
        attachment.filename.toLowerCase().endsWith('.pdf') ||
        
        // Microsoft Word documents
        attachment.contentType === 'application/msword' ||
        attachment.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        attachment.filename.toLowerCase().endsWith('.doc') ||
        attachment.filename.toLowerCase().endsWith('.docx') ||
        
        // Images (common for scanned POs)
        attachment.contentType?.startsWith('image/') ||
        attachment.filename.toLowerCase().match(/\.(jpg|jpeg|png|gif|bmp|tiff|webp)$/i) ||
        
        // Spreadsheet formats
        attachment.contentType === 'text/csv' ||
        attachment.contentType === 'application/vnd.ms-excel' ||
        attachment.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        attachment.filename.toLowerCase().endsWith('.csv') ||
        attachment.filename.toLowerCase().endsWith('.xls') ||
        attachment.filename.toLowerCase().endsWith('.xlsx') ||
        
        // Text files
        attachment.contentType === 'text/plain' ||
        attachment.filename.toLowerCase().endsWith('.txt') ||
        
        // RTF and other document formats
        attachment.contentType === 'application/rtf' ||
        attachment.filename.toLowerCase().endsWith('.rtf')
      );
      
      if (isProcessableDocument && attachment.attachmentId) {
        try {
          // Download the attachment
          const attachmentData = await this.downloadAttachment(messageId, attachment.attachmentId);
          
          // Store in object storage
          const { ObjectStorageService } = await import('../objectStorage');
          const objectStorageService = new ObjectStorageService();
          
          const storagePath = await objectStorageService.storePdfAttachment(
            messageId,
            attachment.filename,
            attachmentData
          );
          
          storedAttachments.push({
            filename: attachment.filename,
            storagePath,
            buffer: attachmentData
          });

          console.log(`      ✅ Stored attachment: ${attachment.filename} at ${storagePath}`);
        } catch (error) {
          console.error(`      ❌ Error storing attachment ${attachment.filename}:`, error);
        }
      } else if (!attachment.attachmentId) {
        console.log(`      ⚠️  Skipping ${attachment.filename}: No attachment ID`);
      } else {
        console.log(`      ⚠️  Skipping ${attachment.filename}: Not a processable document type`);
      }
    }
    
    return storedAttachments;
  }
}

export const gmailService = new GmailService();
