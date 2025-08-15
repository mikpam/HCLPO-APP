export interface AirtableRecord {
  id?: string;
  fields: Record<string, any>;
}

export interface AirtablePORecord {
  'PO Number': string;
  'Customer Meta': any;
  'Shipping Carrier': string;
  'Shipping Method': string;
  'Original JSON': any;
  'Validated JSON': any;
  'Original PDF Filename': string;
  'NS External ID': string;
  'NS Internal ID': string;
  'Status': string;
  'Comments': string;
  'POkey': string;
}

export interface AirtableErrorRecord {
  'Type': string;
  'Message': string;
  'Related PO': string;
  'Resolved': boolean;
  'Resolved At': string;
  'Metadata': any;
}

export class AirtableService {
  private baseId: string;
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_API_KEY_ENV_VAR || '';
    this.baseId = process.env.AIRTABLE_BASE_ID || '';
    this.baseUrl = `https://api.airtable.com/v0/${this.baseId}`;
  }

  private async makeRequest(method: string, endpoint: string, data?: any): Promise<any> {
    const url = `${this.baseUrl}/${endpoint}`;
    
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: data ? JSON.stringify(data) : undefined
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Airtable API error: ${response.status} ${error}`);
    }

    return await response.json();
  }

  async createPORecord(record: Partial<AirtablePORecord>): Promise<string> {
    try {
      const response = await this.makeRequest('POST', 'Purchase Orders', {
        fields: record
      });
      return response.id;
    } catch (error) {
      console.error('Error creating PO record:', error);
      throw new Error(`Failed to create PO record: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updatePORecord(recordId: string, fields: Partial<AirtablePORecord>): Promise<void> {
    try {
      await this.makeRequest('PATCH', `Purchase Orders/${recordId}`, {
        fields
      });
    } catch (error) {
      console.error('Error updating PO record:', error);
      throw new Error(`Failed to update PO record: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getPORecords(filter?: string): Promise<AirtableRecord[]> {
    try {
      const endpoint = filter ? `Purchase Orders?filterByFormula=${encodeURIComponent(filter)}` : 'Purchase Orders';
      const response = await this.makeRequest('GET', endpoint);
      return response.records || [];
    } catch (error) {
      console.error('Error fetching PO records:', error);
      throw new Error(`Failed to fetch PO records: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createErrorLog(record: Partial<AirtableErrorRecord>): Promise<string> {
    try {
      const response = await this.makeRequest('POST', 'Error Logs', {
        fields: record
      });
      return response.id;
    } catch (error) {
      console.error('Error creating error log:', error);
      throw new Error(`Failed to create error log: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateErrorLog(recordId: string, fields: Partial<AirtableErrorRecord>): Promise<void> {
    try {
      await this.makeRequest('PATCH', `Error Logs/${recordId}`, {
        fields
      });
    } catch (error) {
      console.error('Error updating error log:', error);
      throw new Error(`Failed to update error log: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getErrorLogs(filter?: string): Promise<AirtableRecord[]> {
    try {
      const endpoint = filter ? `Error Logs?filterByFormula=${encodeURIComponent(filter)}` : 'Error Logs';
      const response = await this.makeRequest('GET', endpoint);
      return response.records || [];
    } catch (error) {
      console.error('Error fetching error logs:', error);
      throw new Error(`Failed to fetch error logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getReadyForImport(): Promise<AirtableRecord[]> {
    return this.getPORecords('{Status} = "ready for NS import"');
  }

  async getProcessingErrors(): Promise<AirtableRecord[]> {
    return this.getErrorLogs('AND({Resolved} = FALSE(), {Type} = "Processing Error")');
  }
}

export const airtableService = new AirtableService();
