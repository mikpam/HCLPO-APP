export class DropboxService {
  private accessToken: string;
  private baseUrl = 'https://api.dropboxapi.com/2';

  constructor() {
    this.accessToken = process.env.DROPBOX_ACCESS_TOKEN || process.env.DROPBOX_ACCESS_TOKEN_ENV_VAR || '';
  }

  private async makeRequest(endpoint: string, method: string = 'POST', data?: any, isUpload = false): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
    };

    if (isUpload) {
      headers['Content-Type'] = 'application/octet-stream';
      if (data?.args) {
        headers['Dropbox-API-Arg'] = JSON.stringify(data.args);
      }
    } else {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: isUpload ? data.content : (data ? JSON.stringify(data) : undefined)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dropbox API error: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  async uploadFile(path: string, content: Buffer): Promise<{ id: string; path: string }> {
    try {
      const result = await this.makeRequest('/files/upload', 'POST', {
        args: {
          path,
          mode: 'add',
          autorename: true
        },
        content
      }, true);

      return {
        id: result.id,
        path: result.path_lower
      };
    } catch (error) {
      console.error('Error uploading file to Dropbox:', error);
      throw new Error(`File upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async downloadFile(path: string): Promise<Buffer> {
    try {
      const response = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path })
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Download failed: ${response.status} ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('Error downloading file from Dropbox:', error);
      throw new Error(`File download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async searchFiles(query: string): Promise<Array<{ name: string; path: string }>> {
    try {
      const result = await this.makeRequest('/files/search_v2', 'POST', {
        query,
        options: {
          path: '',
          max_results: 100,
          file_status: 'active',
          filename_only: true
        }
      });

      return result.matches?.map((match: any) => ({
        name: match.metadata.metadata.name,
        path: match.metadata.metadata.path_lower
      })) || [];
    } catch (error) {
      console.error('Error searching files in Dropbox:', error);
      throw new Error(`File search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async findPDFByFilename(filename: string): Promise<string | null> {
    try {
      const searchResults = await this.searchFiles(filename);
      
      // Find exact match or best match
      const exactMatch = searchResults.find(file => file.name === filename);
      if (exactMatch) return exactMatch.path;

      // Look for partial matches
      const partialMatch = searchResults.find(file => 
        file.name.toLowerCase().includes(filename.toLowerCase()) ||
        filename.toLowerCase().includes(file.name.toLowerCase())
      );

      return partialMatch?.path || null;
    } catch (error) {
      console.error('Error finding PDF by filename:', error);
      return null;
    }
  }
}

export const dropboxService = new DropboxService();
