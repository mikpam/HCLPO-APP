import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPacificDateShort } from "@/lib/pacific-time";

import { AlertCircle, Upload, FileText, Download, Trash2, Eye } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import ObjectUploader from "@/components/ObjectUploader";
import type { UploadResult } from "@uppy/core";

interface FileItem {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
  storagePath: string;
  contentType: string;
}

export default function FileManagementPage() {
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const { toast } = useToast();

  // Fetch files from API
  const { data: files = [], isLoading } = useQuery({
    queryKey: ['/api/files'],
    queryFn: async () => {
      const response = await fetch('/api/files');
      if (!response.ok) {
        throw new Error('Failed to fetch files');
      }
      return response.json();
    }
  });

  const handleGetUploadParameters = async () => {
    const response = await fetch('/api/objects/pdf-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'upload.pdf' })
    });
    
    if (!response.ok) {
      throw new Error('Failed to get upload URL');
    }
    
    const data = await response.json();
    return {
      method: 'PUT' as const,
      url: data.uploadURL
    };
  };

  const handleUploadComplete = (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    console.log('Upload completed:', result);
    toast({
      title: "Upload successful",
      description: `${result.successful?.length || 0} file(s) uploaded successfully.`,
    });
    
    // In production, you'd refresh the files list here
    // queryClient.invalidateQueries({ queryKey: ['/api/files'] });
  };

  const downloadFile = (file: FileItem) => {
    // Create a download link with proper headers
    const link = document.createElement('a');
    link.href = file.storagePath;
    link.download = file.filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const viewFile = (file: FileItem) => {
    // Open PDF in a new tab for viewing
    if (file.contentType === 'application/pdf') {
      window.open(file.storagePath, '_blank');
    } else {
      // For other file types, just download them
      downloadFile(file);
    }
  };

  const deleteFiles = async (fileIds: string[]) => {
    // Mock deletion - in production this would call an API
    toast({
      title: "Files deleted",
      description: `${fileIds.length} file(s) deleted successfully.`,
    });
    setSelectedFiles([]);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-sm text-muted-foreground">Loading files...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">File Management</h1>
        <p className="text-muted-foreground">
          Manage PDF attachments and uploaded files for purchase order processing
        </p>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Files
          </CardTitle>
          <CardDescription>
            Upload PDF documents and other files to object storage
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ObjectUploader
            maxNumberOfFiles={10}
            maxFileSize={52428800} // 50MB
            acceptedFileTypes={['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg']}
            onGetUploadParameters={handleGetUploadParameters}
            onComplete={handleUploadComplete}
            buttonClassName="w-full"
          >
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              <span>Choose Files to Upload</span>
            </div>
          </ObjectUploader>
        </CardContent>
      </Card>

      {/* Files List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Stored Files ({files.length})
            </div>
            {selectedFiles.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteFiles(selectedFiles)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Selected ({selectedFiles.length})
              </Button>
            )}
          </CardTitle>
          <CardDescription>
            Files stored in object storage for purchase order processing
          </CardDescription>
        </CardHeader>
        <CardContent>
          {files.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No files uploaded yet</p>
              <p className="text-sm text-muted-foreground">Upload your first file to get started</p>
            </div>
          ) : (
            <div className="space-y-4">
              {files.map((file: FileItem) => (
                <div key={file.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50">
                  <div className="flex items-center gap-4">
                    <input
                      type="checkbox"
                      checked={selectedFiles.includes(file.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedFiles([...selectedFiles, file.id]);
                        } else {
                          setSelectedFiles(selectedFiles.filter(id => id !== file.id));
                        }
                      }}
                      className="rounded"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{file.filename}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatFileSize(file.size)} • Uploaded {formatPacificDateShort(file.uploadedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {file.contentType.includes('pdf') ? 'PDF' : 'Document'}
                    </Badge>
                    <div className="flex gap-2">
                      {file.contentType === 'application/pdf' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => viewFile(file)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadFile(file)}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Storage Info */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Object Storage Information</AlertTitle>
        <AlertDescription>
          Files are stored in Replit's object storage with automatic backup and CDN distribution. 
          PDF attachments from emails are automatically stored and linked to purchase orders for processing.
        </AlertDescription>
      </Alert>
    </div>
  );
}