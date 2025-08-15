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
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      // Impersonate the target Gmail account
      subject: 'hclpurchaseorders@metrixdigital.com'
    });

    this.gmail = google.gmail({ version: 'v1', auth });
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

  private async extractAttachments(payload: gmail_v1.Schema$MessagePart): Promise<Array<{
    filename: string;
    contentType: string;
    size: number;
    data?: Buffer;
  }>> {
    const attachments: Array<{
      filename: string;
      contentType: string;
      size: number;
      data?: Buffer;
    }> = [];

    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.filename && part.body?.attachmentId) {
          attachments.push({
            filename: part.filename,
            contentType: part.mimeType || 'application/octet-stream',
            size: part.body.size || 0,
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

  async markAsProcessed(messageId: string): Promise<void> {
    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['unprocessed'],
          addLabelIds: ['processed']
        }
      });
    } catch (error) {
      console.error('Error marking message as processed:', error);
      throw new Error(`Failed to update message labels: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export const gmailService = new GmailService();
