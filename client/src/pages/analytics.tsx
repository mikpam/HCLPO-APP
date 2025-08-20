import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DashboardMetrics, SystemHealthItem } from "@/types";
import { PurchaseOrder, ErrorLog, EmailQueue } from "@shared/schema";
import { useState } from "react";
import { Eye, AlertTriangle, CheckCircle, Clock, Bug, Activity, Database, Cpu, Timer, TrendingUp, AlertCircle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts';

export default function AnalyticsPage() {
  const [selectedError, setSelectedError] = useState<ErrorLog | null>(null);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
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
    refetchInterval: 30000
  });

  const { data: emailQueue, isLoading: emailLoading } = useQuery<EmailQueue[]>({
    queryKey: ["/api/email-queue"],
    refetchInterval: 60000
  });

  // Performance monitoring queries
  const { data: performanceSummary, isLoading: perfSummaryLoading } = useQuery({
    queryKey: ["/api/performance/summary"],
    refetchInterval: 10000 // Update every 10 seconds for real-time monitoring
  });

  const { data: memoryTrend, isLoading: memoryLoading } = useQuery({
    queryKey: ["/api/performance/memory-trend"],
    refetchInterval: 15000 // Update every 15 seconds
  });

  const { data: emailStats, isLoading: emailStatsLoading } = useQuery({
    queryKey: ["/api/performance/email-stats"],
    refetchInterval: 30000 // Update every 30 seconds
  });

  const { data: performanceHistory, isLoading: historyLoading } = useQuery({
    queryKey: ["/api/performance/history"],
    refetchInterval: 20000 // Update every 20 seconds
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
      resolutionRate: totalErrors > 0 ? (resolvedErrors / totalErrors) * 100 : 0,
      errorRate: totalErrors === 0 ? 0 : (pendingErrors / totalErrors) * 100
    };
  };

  const processingAnalytics = getProcessingAnalytics();
  const routeAnalytics = getRouteAnalytics();
  const confidenceAnalytics = getConfidenceAnalytics();
  const errorAnalytics = getErrorAnalytics();

  // Helper functions for error display
  const getErrorTypeVariant = (type: string): "default" | "secondary" | "destructive" | "outline" => {
    if (type.includes('bulk_processing')) return 'destructive';
    if (type.includes('critical') || type.includes('failure')) return 'destructive';
    if (type.includes('warning')) return 'outline';
    return 'secondary';
  };

  const formatErrorType = (type: string): string => {
    return type
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatErrorDate = (date: string | Date): string => {
    const d = new Date(date);
    const now = new Date();
    const diffInHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 1) {
      const minutes = Math.floor(diffInHours * 60);
      return `${minutes}m ago`;
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else {
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  };

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
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="processing">Processing</TabsTrigger>
            <TabsTrigger value="errors">Errors</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
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
                      `${Math.round(errorAnalytics?.errorRate || 0)}%`
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

            {/* Detailed Error Logs Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bug className="h-5 w-5" />
                  Detailed Error Logs
                </CardTitle>
              </CardHeader>
              <CardContent>
                {errorsLoading ? (
                  <div className="space-y-4">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center space-x-4 p-3 rounded-lg bg-gray-50 animate-pulse">
                        <div className="w-24 h-4 bg-gray-200 rounded"></div>
                        <div className="flex-1 h-4 bg-gray-200 rounded"></div>
                        <div className="w-20 h-4 bg-gray-200 rounded"></div>
                        <div className="w-8 h-4 bg-gray-200 rounded"></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-hidden">
                    {errorLogs && errorLogs.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Message</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {errorLogs.slice(0, 10).map((error) => (
                            <TableRow key={error.id}>
                              <TableCell>
                                <Badge variant={getErrorTypeVariant(error.type)}>
                                  {formatErrorType(error.type)}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-md">
                                <div className="truncate" title={error.message}>
                                  {error.message}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-gray-500">
                                {formatErrorDate(error.createdAt)}
                              </TableCell>
                              <TableCell>
                                {error.resolved ? (
                                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Resolved
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Pending
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedError(error);
                                    setIsErrorModalOpen(true);
                                  }}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-center py-12">
                        <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-slate-800 mb-2">No Errors Found</h3>
                        <p className="text-gray-500">
                          Great! No errors have been logged recently.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            {/* Performance Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-secondary flex items-center gap-2">
                    <Cpu className="h-4 w-4" />
                    Memory Usage
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {perfSummaryLoading ? (
                    <div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div>
                  ) : (
                    <div>
                      <div className="text-2xl font-bold text-slate-800">
                        {Math.round(performanceSummary?.memoryUsageMB || 0)}MB
                      </div>
                      <div className="text-xs text-secondary mt-1">
                        {Math.round(performanceSummary?.memoryUsagePercent || 0)}% of heap
                      </div>
                      {(performanceSummary?.memoryUsagePercent || 0) > 85 && (
                        <Badge variant="destructive" className="mt-2 text-xs">High Usage</Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-secondary flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Database Size
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {perfSummaryLoading ? (
                    <div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div>
                  ) : (
                    <div>
                      <div className="text-2xl font-bold text-slate-800">
                        {Math.round(performanceSummary?.databaseSizeMB || 0)}MB
                      </div>
                      <div className="text-xs text-secondary mt-1">Total storage</div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-secondary flex items-center gap-2">
                    <Timer className="h-4 w-4" />
                    Avg Processing Time
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {perfSummaryLoading ? (
                    <div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div>
                  ) : (
                    <div>
                      <div className="text-2xl font-bold text-slate-800">
                        {Math.round((performanceSummary?.averageProcessingTime || 0) / 1000)}s
                      </div>
                      <div className="text-xs text-secondary mt-1">Per email</div>
                      {(performanceSummary?.averageProcessingTime || 0) > 30000 && (
                        <Badge variant="destructive" className="mt-2 text-xs">Slow Processing</Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-secondary flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    System Uptime
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {perfSummaryLoading ? (
                    <div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div>
                  ) : (
                    <div>
                      <div className="text-2xl font-bold text-slate-800">
                        {Math.round((performanceSummary?.systemUptime || 0) / 3600)}h
                      </div>
                      <div className="text-xs text-secondary mt-1">Running time</div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* System Alerts */}
            {performanceSummary?.alerts && performanceSummary.alerts.length > 0 && (
              <Card className="border-red-200 bg-red-50">
                <CardHeader>
                  <CardTitle className="text-red-800 flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    System Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {performanceSummary.alerts.map((alert, index) => (
                      <div key={index} className="flex items-center gap-2 p-2 bg-white rounded border-l-4 border-red-400">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        <span className="text-sm text-red-800">{alert}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Memory Usage Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Memory Usage Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                {memoryLoading ? (
                  <div className="h-64 bg-gray-100 rounded animate-pulse"></div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={memoryTrend ? memoryTrend.timestamps.map((time, index) => ({
                        time,
                        heapUsed: memoryTrend.heapUsed[index],
                        rss: memoryTrend.rss[index]
                      })) : []}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" />
                        <YAxis label={{ value: 'Memory (MB)', angle: -90, position: 'insideLeft' }} />
                        <Tooltip formatter={(value, name) => [`${value}MB`, name === 'heapUsed' ? 'Heap Used' : 'RSS']} />
                        <Line type="monotone" dataKey="heapUsed" stroke="#8884d8" strokeWidth={2} name="Heap Used" />
                        <Line type="monotone" dataKey="rss" stroke="#82ca9d" strokeWidth={2} name="RSS" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Email Processing Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Timer className="h-5 w-5" />
                    Email Processing Stats
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {emailStatsLoading ? (
                    <div className="space-y-4">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex justify-between p-3 bg-gray-50 rounded animate-pulse">
                          <div className="w-32 h-4 bg-gray-200 rounded"></div>
                          <div className="w-16 h-4 bg-gray-200 rounded"></div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-between p-3 bg-blue-50 rounded">
                        <span className="font-medium">Total Processed</span>
                        <Badge variant="secondary">{emailStats?.totalProcessed || 0}</Badge>
                      </div>
                      <div className="flex justify-between p-3 bg-green-50 rounded">
                        <span className="font-medium">Success Rate</span>
                        <Badge className="bg-green-600">{Math.round(emailStats?.successRate || 0)}%</Badge>
                      </div>
                      <div className="flex justify-between p-3 bg-amber-50 rounded">
                        <span className="font-medium">Average Time</span>
                        <Badge variant="outline">{Math.round((emailStats?.averageTime || 0) / 1000)}s</Badge>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Processing Time Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  {emailStatsLoading ? (
                    <div className="h-48 bg-gray-100 rounded animate-pulse"></div>
                  ) : (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={emailStats ? emailStats.recentTimes.map((time, index) => ({
                          email: `Email ${index + 1}`,
                          time: Math.round(time / 1000)
                        })) : []}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="email" />
                          <YAxis label={{ value: 'Time (seconds)', angle: -90, position: 'insideLeft' }} />
                          <Tooltip formatter={(value) => [`${value}s`, 'Processing Time']} />
                          <Area type="monotone" dataKey="time" stroke="#8884d8" fill="#8884d8" fillOpacity={0.3} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="monitoring" className="space-y-6">
            {/* Real-time System Monitoring */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Real-time System Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="h-80 bg-gray-100 rounded animate-pulse"></div>
                ) : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={performanceHistory ? performanceHistory.map((metric, index) => ({
                        time: new Date(metric.timestamp).toLocaleTimeString(),
                        memory: metric.memory.heapUsed,
                        database: metric.storage.databaseSizeMB,
                        queue: metric.processing.currentQueueSize,
                        emailRate: metric.processing.emailsPerMinute
                      })) : []}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" />
                        <YAxis yAxisId="left" label={{ value: 'Memory/DB (MB)', angle: -90, position: 'insideLeft' }} />
                        <YAxis yAxisId="right" orientation="right" label={{ value: 'Queue/Rate', angle: 90, position: 'insideRight' }} />
                        <Tooltip />
                        <Line yAxisId="left" type="monotone" dataKey="memory" stroke="#8884d8" strokeWidth={2} name="Memory (MB)" />
                        <Line yAxisId="left" type="monotone" dataKey="database" stroke="#82ca9d" strokeWidth={2} name="Database (MB)" />
                        <Line yAxisId="right" type="monotone" dataKey="queue" stroke="#ffc658" strokeWidth={2} name="Queue Size" />
                        <Line yAxisId="right" type="monotone" dataKey="emailRate" stroke="#ff7300" strokeWidth={2} name="Emails/min" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Performance Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Memory Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  {perfSummaryLoading ? (
                    <div className="h-32 bg-gray-100 rounded animate-pulse"></div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span>Heap Used</span>
                        <span>{Math.round(performanceSummary?.memoryUsageMB || 0)}MB</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full" 
                          style={{ width: `${Math.min(performanceSummary?.memoryUsagePercent || 0, 100)}%` }}
                        ></div>
                      </div>
                      <div className="text-xs text-gray-500">
                        {Math.round(performanceSummary?.memoryUsagePercent || 0)}% of available heap
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Processing Queue</CardTitle>
                </CardHeader>
                <CardContent>
                  {perfSummaryLoading ? (
                    <div className="h-32 bg-gray-100 rounded animate-pulse"></div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-center">
                        <div className="text-3xl font-bold text-slate-800">
                          {performanceSummary?.emailsPerMinute || 0}
                        </div>
                        <div className="text-sm text-gray-500">emails/minute</div>
                      </div>
                      <div className="pt-2">
                        {(performanceSummary?.emailsPerMinute || 0) > 0 ? (
                          <Badge className="bg-green-600 text-white">Processing Active</Badge>
                        ) : (
                          <Badge variant="outline">Idle</Badge>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Health Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Memory</span>
                      {(performanceSummary?.memoryUsagePercent || 0) < 85 ? (
                        <Badge className="bg-green-600 text-white">Healthy</Badge>
                      ) : (
                        <Badge variant="destructive">High</Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Processing</span>
                      {(performanceSummary?.averageProcessingTime || 0) < 30000 ? (
                        <Badge className="bg-green-600 text-white">Normal</Badge>
                      ) : (
                        <Badge variant="destructive">Slow</Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">System</span>
                      <Badge className="bg-green-600 text-white">Online</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Error Details Modal */}
      <Dialog open={isErrorModalOpen} onOpenChange={setIsErrorModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Error Details
            </DialogTitle>
            <DialogDescription>
              Complete error information and metadata
            </DialogDescription>
          </DialogHeader>
          
          {selectedError && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-600">Type</label>
                  <div className="mt-1">
                    <Badge variant={getErrorTypeVariant(selectedError.type)}>
                      {formatErrorType(selectedError.type)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Status</label>
                  <div className="mt-1">
                    {selectedError.resolved ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Resolved
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                        <Clock className="h-3 w-3 mr-1" />
                        Pending
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-600">Error Message</label>
                <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                  <p className="text-sm">{selectedError.message}</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-600">Timestamp</label>
                <div className="mt-1">
                  <p className="text-sm text-gray-700">
                    {new Date(selectedError.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {selectedError.metadata && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Additional Details</label>
                  <div className="mt-1 p-3 bg-gray-50 rounded-lg">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto">
                      {JSON.stringify(selectedError.metadata, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {!selectedError.resolved && (
                <div className="flex justify-end pt-4 border-t">
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      // TODO: Add resolve error functionality
                      console.log('Resolve error:', selectedError.id);
                    }}
                  >
                    Mark as Resolved
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
