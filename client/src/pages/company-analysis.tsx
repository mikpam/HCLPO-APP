import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Building2, Search, Users, AlertTriangle, CheckCircle, Sparkles, Zap, RefreshCw } from "lucide-react";

interface CompanyCrossRefData {
  summary: {
    totalContactCompanies: number;
    totalCustomerCompanies: number;
    matchedCompanies: number;
    missingCompanies: number;
  };
  topMissingCompanies: Array<{
    company: string;
    contactCount: number;
  }>;
  allMissingCompanies: Array<{
    company: string;
    contactCount: number;
  }>;
  exactMatches: number;
  partialMatches: number;
}

interface EnhancedAnalysisData {
  summary: {
    totalAnalyzed: number;
    genuinelyMissing: number;
    falsePositives: number;
    accuracyImprovement: string;
  };
  genuinelyMissingCompanies: string[];
  falsePositives: string[];
  detailedResults: Array<{
    contactCompany: string;
    potentialMatches: Array<{
      customerName: string;
      customerNumber: string;
      confidence: number;
      reasoning: string;
    }>;
    isGenuinelyMissing: boolean;
    aiReasoning: string;
  }>;
}

export default function CompanyAnalysisPage() {
  const [showAllMissing, setShowAllMissing] = useState(false);
  const [showEnhancedResults, setShowEnhancedResults] = useState(true);
  const queryClient = useQueryClient();

  const { data: analysisData, isLoading, refetch } = useQuery<CompanyCrossRefData>({
    queryKey: ['/api/analysis/company-crossref'],
    refetchOnWindowFocus: false,
  });

  const enhancedAnalysisMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/analysis/enhanced-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Enhanced analysis failed');
      return response.json();
    },
    onSuccess: (data) => {
      setShowEnhancedResults(true);
      queryClient.setQueryData(['enhanced-analysis'], data);
    },
  });

  // Auto-load enhanced analysis on page load
  const { data: enhancedData, isLoading: isEnhancedLoading } = useQuery<EnhancedAnalysisData>({
    queryKey: ['enhanced-analysis'],
    queryFn: async () => {
      const response = await fetch('/api/analysis/enhanced-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error('Enhanced analysis failed');
      return response.json();
    },
    refetchOnWindowFocus: false,
  });

  if (isLoading || isEnhancedLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Building2 className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Company Cross-Reference Analysis</h1>
          </div>
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">
              {isEnhancedLoading ? 'Running AI-Enhanced Analysis...' : 'Analyzing company databases...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!analysisData) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Building2 className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Company Cross-Reference Analysis</h1>
          </div>
          <div className="text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <p className="text-gray-600">Unable to load analysis data</p>
            <Button onClick={() => refetch()} className="mt-4">
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { summary, topMissingCompanies, allMissingCompanies } = analysisData;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Building2 className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Company Cross-Reference Analysis</h1>
          </div>
          <div className="flex gap-3">
            <Button 
              onClick={() => enhancedAnalysisMutation.mutate()} 
              disabled={enhancedAnalysisMutation.isPending}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              {enhancedAnalysisMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              AI-Enhanced Analysis
            </Button>
            <Button onClick={() => refetch()} variant="outline">
              <Search className="h-4 w-4 mr-2" />
              Refresh Analysis
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Contact Companies</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalContactCompanies.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Unique companies in contact database
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Customer Companies</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalCustomerCompanies.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Companies in customer database
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Matched Companies</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{summary.matchedCompanies.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                {analysisData.exactMatches} exact, {analysisData.partialMatches} partial
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Missing Companies</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{summary.missingCompanies.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Not found in customer database
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Enhanced Analysis Results */}
        {showEnhancedResults && enhancedData && (
          <Card className="mb-8 border-purple-200 bg-gradient-to-r from-purple-50 to-blue-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-800">
                <Sparkles className="h-5 w-5" />
                AI-Enhanced Analysis Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">{enhancedData.summary.genuinelyMissing}</div>
                  <p className="text-sm text-gray-600">Genuinely Missing</p>
                  <p className="text-xs text-gray-500">Real gaps in your database</p>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">{enhancedData.summary.falsePositives}</div>
                  <p className="text-sm text-gray-600">False Positives</p>
                  <p className="text-xs text-gray-500">Companies that exist under different names</p>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-purple-600">
                    {enhancedData.summary.accuracyImprovement}
                  </div>
                  <p className="text-sm text-gray-600">Accuracy Improvement</p>
                  <p className="text-xs text-gray-500">Reduction in false missing companies</p>
                </div>
              </div>
              
              {enhancedData.summary.genuinelyMissing > 0 && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h4 className="font-medium text-green-800 mb-2">Genuinely Missing Companies</h4>
                  <div className="space-y-1">
                    {enhancedData.genuinelyMissingCompanies.slice(0, 5).map((company, index) => (
                      <div key={index} className="text-sm text-green-700">• {company}</div>
                    ))}
                    {enhancedData.genuinelyMissingCompanies.length > 5 && (
                      <div className="text-sm text-green-600 font-medium">
                        ... and {enhancedData.genuinelyMissingCompanies.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {enhancedData.summary.falsePositives > 0 && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="font-medium text-blue-800 mb-2">False Positives Detected</h4>
                  <p className="text-sm text-blue-700 mb-2">
                    These companies exist in your database under different names:
                  </p>
                  <div className="space-y-1">
                    {enhancedData.falsePositives.slice(0, 3).map((company, index) => (
                      <div key={index} className="text-sm text-blue-700">• {company}</div>
                    ))}
                    {enhancedData.falsePositives.length > 3 && (
                      <div className="text-sm text-blue-600 font-medium">
                        ... and {enhancedData.falsePositives.length - 3} more variations detected
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Loading state for Enhanced Analysis */}
        {isEnhancedLoading && (
          <Card className="mb-8 border-purple-200 bg-gradient-to-r from-purple-50 to-blue-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-800">
                <Sparkles className="h-5 w-5" />
                AI-Enhanced Analysis Running...
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
                  <p className="text-purple-700 font-medium">Processing your companies with OpenAI...</p>
                  <p className="text-sm text-purple-600 mt-1">Analyzing name variations and detecting false positives</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Missing Companies Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Companies Missing from Customer Database
              </CardTitle>
              <div className="flex gap-2">
                <Badge variant="outline">
                  {showAllMissing ? `All ${allMissingCompanies.length}` : `Top ${Math.min(20, topMissingCompanies.length)}`} shown
                </Badge>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = '/api/analysis/missing-companies/download';
                    link.download = `missing-companies-${new Date().toISOString().split('T')[0]}.csv`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                >
                  Download CSV
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowAllMissing(!showAllMissing)}
                >
                  {showAllMissing ? 'Show Top 20' : 'Show All'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Company Name</TableHead>
                    <TableHead className="text-right">Contact Count</TableHead>
                    <TableHead className="text-right">Priority</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(showAllMissing ? allMissingCompanies : topMissingCompanies).map((company, index) => (
                    <TableRow key={company.company}>
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell className="font-medium">{company.company}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={company.contactCount >= 10 ? "destructive" : company.contactCount >= 5 ? "default" : "secondary"}>
                          {company.contactCount}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {company.contactCount >= 10 ? (
                          <Badge variant="destructive">High</Badge>
                        ) : company.contactCount >= 5 ? (
                          <Badge variant="default">Medium</Badge>
                        ) : (
                          <Badge variant="secondary">Low</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            
            {summary.missingCompanies > 0 && (
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-amber-800">Action Required</h3>
                    <p className="text-sm text-amber-700 mt-1">
                      {summary.missingCompanies} companies from your contact database are not in your customer database. 
                      Companies with higher contact counts should be prioritized for manual entry or investigation.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}