import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { Building2, Search, Users, AlertTriangle, CheckCircle } from "lucide-react";

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

export default function CompanyAnalysisPage() {
  const [showAllMissing, setShowAllMissing] = useState(false);

  const { data: analysisData, isLoading, refetch } = useQuery<CompanyCrossRefData>({
    queryKey: ['/api/analysis/company-crossref'],
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Building2 className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Company Cross-Reference Analysis</h1>
          </div>
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Analyzing company databases...</p>
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
          <Button onClick={() => refetch()} variant="outline">
            <Search className="h-4 w-4 mr-2" />
            Refresh Analysis
          </Button>
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