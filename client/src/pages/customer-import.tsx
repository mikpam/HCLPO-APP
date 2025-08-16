import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Upload, CheckCircle, AlertCircle, FileText, Database } from "lucide-react";

interface ImportResult {
  success: boolean;
  imported: number;
  errors: number;
  errorDetails: any[];
  message: string;
}

export default function CustomerImport() {
  const [csvData, setCsvData] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const queryClient = useQueryClient();

  const bulkImportMutation = useMutation({
    mutationFn: async (data: any): Promise<ImportResult> => {
      const response = await apiRequest("POST", "/api/customers/bulk-import", data);
      return await response.json();
    },
    onSuccess: (result: ImportResult) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
    },
  });

  const handleCsvImport = () => {
    try {
      // Parse CSV data
      const lines = csvData.trim().split('\n');
      if (lines.length < 2) {
        throw new Error('CSV must have header row and at least one data row');
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const customers = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const customer: any = {};
        
        headers.forEach((header, index) => {
          if (values[index]) {
            customer[header] = values[index];
          }
        });
        
        customers.push(customer);
      }

      bulkImportMutation.mutate({
        customers,
        format: 'csv'
      });
    } catch (error) {
      setImportResult({
        success: false,
        imported: 0,
        errors: 1,
        errorDetails: [{ error: error instanceof Error ? error.message : 'CSV parsing failed' }],
        message: 'Failed to parse CSV data'
      });
    }
  };

  const handleJsonImport = () => {
    try {
      const customers = JSON.parse(csvData);
      if (!Array.isArray(customers)) {
        throw new Error('JSON must be an array of customer objects');
      }

      bulkImportMutation.mutate({
        customers,
        format: 'json'
      });
    } catch (error) {
      setImportResult({
        success: false,
        imported: 0,
        errors: 1,
        errorDetails: [{ error: error instanceof Error ? error.message : 'JSON parsing failed' }],
        message: 'Failed to parse JSON data'
      });
    }
  };

  const refreshCacheMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/customers/refresh-cache");
      return await response.json();
    },
  });

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customer Import</h1>
          <p className="text-muted-foreground">
            Import your 5,000+ customer records with C numbers
          </p>
        </div>
        <Button
          onClick={() => refreshCacheMutation.mutate()}
          disabled={refreshCacheMutation.isPending}
          variant="outline"
        >
          <Database className="w-4 h-4 mr-2" />
          Refresh Cache
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Import Methods */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Import Options
            </CardTitle>
            <CardDescription>
              Choose your preferred method to import customer data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="p-4 border rounded-lg">
                <h3 className="font-semibold mb-2">1. CSV Format</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Upload CSV with headers: customerNumber, companyName, email, phone, address
                </p>
                <code className="text-xs bg-gray-100 p-2 block rounded">
                  customerNumber,companyName,email,phone{'\n'}
                  C12345,"ACME Corp","info@acme.com","555-0123"
                </code>
              </div>

              <div className="p-4 border rounded-lg">
                <h3 className="font-semibold mb-2">2. JSON Format</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Upload JSON array of customer objects
                </p>
                <code className="text-xs bg-gray-100 p-2 block rounded">
                  [{`{"customerNumber": "C12345", "companyName": "ACME Corp"}`}]
                </code>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Data Input */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Paste Your Data
            </CardTitle>
            <CardDescription>
              Paste CSV or JSON data below
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Paste your CSV or JSON customer data here..."
              value={csvData}
              onChange={(e) => setCsvData(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
            />
            
            <div className="flex gap-2">
              <Button
                onClick={handleCsvImport}
                disabled={!csvData.trim() || bulkImportMutation.isPending}
                className="flex-1"
              >
                Import as CSV
              </Button>
              <Button
                onClick={handleJsonImport}
                disabled={!csvData.trim() || bulkImportMutation.isPending}
                variant="outline"
                className="flex-1"
              >
                Import as JSON
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Import Progress */}
      {bulkImportMutation.isPending && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Importing customers...</span>
                <span className="text-sm text-muted-foreground">Processing</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{ width: '50%' }}></div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import Results */}
      {importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {importResult.success ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
              Import Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {importResult.imported}
                </div>
                <div className="text-sm text-muted-foreground">Imported</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">
                  {importResult.errors}
                </div>
                <div className="text-sm text-muted-foreground">Errors</div>
              </div>
            </div>

            <Alert>
              <AlertDescription>{importResult.message}</AlertDescription>
            </Alert>

            {importResult.errorDetails.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold">Error Details:</h4>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {importResult.errorDetails.map((error, index) => (
                    <div key={index} className="text-sm p-2 bg-red-50 rounded border">
                      {error.row && <Badge variant="outline" className="mr-2">Row {error.row}</Badge>}
                      {error.error}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Required Fields Info */}
      <Card>
        <CardHeader>
          <CardTitle>Required Fields</CardTitle>
          <CardDescription>
            Make sure your data includes these required fields
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold text-green-600">Required</h4>
              <ul className="text-sm space-y-1 mt-2">
                <li>• customerNumber (e.g., "C12345")</li>
                <li>• companyName (e.g., "ACME Corp")</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-blue-600">Optional</h4>
              <ul className="text-sm space-y-1 mt-2">
                <li>• email</li>
                <li>• phone</li>
                <li>• address</li>
                <li>• alternateNames (array)</li>
                <li>• netsuiteId</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}