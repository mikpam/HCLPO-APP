import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { DashboardMetrics, SystemHealthItem } from "@/types";
import { PurchaseOrder, ErrorLog, EmailQueue } from "@shared/schema";

export default function AnalyticsPage() {
  const { data: metrics, isLoading: metricsLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
    refetchInterval: 60000
  });

  const { data: purchaseOrders, isLoading: ordersLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders"],
    refetchInterval: 60000
  });

  const { data: errorLogs, isLoading: errorsLoading } = useQuery<ErrorLog[]>({
    queryKey: ["/api/error-logs"],
    refetchInterval: 60000
  });

  const { data: emailQueue, isLoading: emailLoading } = useQuery<EmailQueue[]>({
    queryKey: ["/api/email-queue"],
    refetchInterval: 60000
  });

  // Calculate analytics
  const getProcessingAnalytics = () => {
    if (!purchaseOrders) return null;

    const totalOrders = purchaseOrders.length;
    const processedOrders = purchaseOrders.filter(po => po.status === 'processed' || po.status === 'imported').length;
    const pendingOrders = purchaseOrders.filter(po => po.status?.includes('pending')).length;
    const errorOrders = purchaseOrders.filter(po => po.status === 'error').length;

    const processingRate = totalOrders > 0 ? (processedOrders / totalOrders) * 100 : 0;

    return {
      totalOrders,
      processedOrders,
      pendingOrders,
      errorOrders,
      processingRate
    };
  };

  const getRouteAnalytics = () => {
    if (!purchaseOrders) return null;

    const routeStats = purchaseOrders.reduce((acc, po) => {
      const route = po.route || 'Unknown';
      acc[route] = (acc[route] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return routeStats;
  };

  const getConfidenceAnalytics = () => {
    if (!purchaseOrders) return null;

    const ordersWithConfidence = purchaseOrders.filter(po => po.confidence !== null && po.confidence !== undefined);
    if (ordersWithConfidence.length === 0) return null;

    const avgConfidence = ordersWithConfidence.reduce((sum, po) => sum + (po.confidence || 0), 0) / ordersWithConfidence.length;
    
    const confidenceRanges = {
      high: ordersWithConfidence.filter(po => (po.confidence || 0) >= 0.8).length,
      medium: ordersWithConfidence.filter(po => (po.confidence || 0) >= 0.6 && (po.confidence || 0) < 0.8).length,
      low: ordersWithConfidence.filter(po => (po.confidence || 0) < 0.6).length
    };

    return {
      avgConfidence: avgConfidence * 100,
      confidenceRanges,
      total: ordersWithConfidence.length
    };
  };

  const getErrorAnalytics = () => {
    if (!errorLogs) return null;

    const totalErrors = errorLogs.length;
    const resolvedErrors = errorLogs.filter(error => error.resolved).length;
    const pendingErrors = totalErrors - resolvedErrors;

    const errorTypes = errorLogs.reduce((acc, error) => {
      acc[error.type] = (acc[error.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalErrors,
      resolvedErrors,
      pendingErrors,
      errorTypes,
      resolutionRate: totalErrors > 0 ? (resolvedErrors / totalErrors) * 100 : 0
    };
  };

  const processingAnalytics = getProcessingAnalytics();
  const routeAnalytics = getRouteAnalytics();
  const confidenceAnalytics = getConfidenceAnalytics();
  const errorAnalytics = getErrorAnalytics();

  return (
    <div>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Analytics</h1>
            <p className="text-secondary mt-1">Analyze processing performance and trends</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline">
              <i className="fas fa-download mr-2"></i>
              Export Report
            </Button>
            <Button variant="outline">
              <i className="fas fa-calendar mr-2"></i>
              Date Range
            </Button>
          </div>
        </div>
      </header>

      <div className="p-8">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="processing">Processing</TabsTrigger>
            <TabsTrigger value="errors">Errors</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Key Metrics Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-secondary">Total Orders</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-800">
                    {ordersLoading ? (
                      <div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div>
                    ) : (
                      processingAnalytics?.totalOrders || 0
                    )}
                  </div>
                  <p className="text-xs text-secondary mt-1">All time</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-secondary">Processing Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-800">
                    {ordersLoading ? (
                      <div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div>
                    ) : (
                      `${Math.round(processingAnalytics?.processingRate || 0)}%`
                    )}
                  </div>
                  <p className="text-xs text-success mt-1">↗ Successful completion</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-secondary">Avg Confidence</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-800">
                    {ordersLoading ? (
                      <div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div>
                    ) : (
                      `${Math.round(confidenceAnalytics?.avgConfidence || 0)}%`
                    )}
                  </div>
                  <p className="text-xs text-secondary mt-1">Classification accuracy</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-secondary">Error Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-800">
                    {errorsLoading ? (
                      <div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div>
                    ) : (
                      `${Math.round(100 - (errorAnalytics?.resolutionRate || 0))}%`
                    )}
                  </div>
                  <p className="text-xs text-error mt-1">Needs attention</p>
                </CardContent>
              </Card>
            </div>

            {/* Route Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Processing Route Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {ordersLoading ? (
                  <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex items-center justify-between p-4 rounded-lg bg-gray-50 animate-pulse">
                        <div className="w-24 h-4 bg-gray-200 rounded"></div>
                        <div className="w-16 h-6 bg-gray-200 rounded"></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {routeAnalytics && Object.entries(routeAnalytics).map(([route, count]) => (
                      <div key={route} className="flex items-center justify-between p-4 rounded-lg bg-gray-50">
                        <div className="flex items-center space-x-3">
                          <div className={`w-3 h-3 rounded-full ${
                            route === 'TEXT_PO' ? 'bg-primary' :
                            route === 'ATTACHMENT_PO' ? 'bg-warning' :
                            route === 'REVIEW' ? 'bg-error' : 'bg-gray-400'
                          }`}></div>
                          <span className="font-medium text-slate-800">{route}</span>
                        </div>
                        <Badge variant="secondary">{count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="processing" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Processing Status Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  {ordersLoading ? (
                    <div className="space-y-4">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 animate-pulse">
                          <div className="w-32 h-4 bg-gray-200 rounded"></div>
                          <div className="w-12 h-4 bg-gray-200 rounded"></div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-green-50">
                        <span className="text-sm font-medium text-slate-800">Processed</span>
                        <Badge className="bg-success text-white">{processingAnalytics?.processedOrders || 0}</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50">
                        <span className="text-sm font-medium text-slate-800">Pending</span>
                        <Badge className="bg-warning text-white">{processingAnalytics?.pendingOrders || 0}</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-red-50">
                        <span className="text-sm font-medium text-slate-800">Errors</span>
                        <Badge className="bg-error text-white">{processingAnalytics?.errorOrders || 0}</Badge>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Confidence Score Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  {ordersLoading ? (
                    <div className="space-y-4">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 animate-pulse">
                          <div className="w-20 h-4 bg-gray-200 rounded"></div>
                          <div className="w-12 h-4 bg-gray-200 rounded"></div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-green-50">
                        <span className="text-sm font-medium text-slate-800">High (80-100%)</span>
                        <Badge className="bg-success text-white">{confidenceAnalytics?.confidenceRanges.high || 0}</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50">
                        <span className="text-sm font-medium text-slate-800">Medium (60-80%)</span>
                        <Badge className="bg-warning text-white">{confidenceAnalytics?.confidenceRanges.medium || 0}</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-red-50">
                        <span className="text-sm font-medium text-slate-800">Low (&lt;60%)</span>
                        <Badge className="bg-error text-white">{confidenceAnalytics?.confidenceRanges.low || 0}</Badge>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="errors" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Error Resolution Statistics</CardTitle>
                </CardHeader>
                <CardContent>
                  {errorsLoading ? (
                    <div className="space-y-4">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 animate-pulse">
                          <div className="w-28 h-4 bg-gray-200 rounded"></div>
                          <div className="w-12 h-4 bg-gray-200 rounded"></div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50">
                        <span className="text-sm font-medium text-slate-800">Total Errors</span>
                        <Badge className="bg-primary text-white">{errorAnalytics?.totalErrors || 0}</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-green-50">
                        <span className="text-sm font-medium text-slate-800">Resolved</span>
                        <Badge className="bg-success text-white">{errorAnalytics?.resolvedErrors || 0}</Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50">
                        <span className="text-sm font-medium text-slate-800">Pending</span>
                        <Badge className="bg-warning text-white">{errorAnalytics?.pendingErrors || 0}</Badge>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Error Types</CardTitle>
                </CardHeader>
                <CardContent>
                  {errorsLoading ? (
                    <div className="space-y-4">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 animate-pulse">
                          <div className="w-32 h-4 bg-gray-200 rounded"></div>
                          <div className="w-8 h-4 bg-gray-200 rounded"></div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {errorAnalytics?.errorTypes && Object.entries(errorAnalytics.errorTypes).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                          <span className="text-sm font-medium text-slate-800">{type}</span>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <div className="grid grid-cols-1 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Performance Metrics</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-12">
                    <i className="fas fa-chart-line text-6xl text-gray-300 mb-4"></i>
                    <h3 className="text-lg font-medium text-slate-800 mb-2">Performance Charts Coming Soon</h3>
                    <p className="text-secondary">
                      Advanced performance analytics and trending charts will be available in the next update.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
