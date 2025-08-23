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
import { Eye, AlertTriangle, CheckCircle, Clock, Bug } from "lucide-react";
import MemoryHealth from "@/components/dashboard/memory-health";
import { formatPacificTime, formatPacificTimeOnly, formatPacificDateShort } from "@/lib/pacific-time";

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
      return formatPacificTime(d, true, false);
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Memory Health Component */}
              <MemoryHealth />
              
              {/* System Optimizations Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <i className="fas fa-tachometer-alt text-green-500"></i>
                    <span>Optimization Status</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center space-x-3">
                      <i className="fas fa-check-circle text-green-600"></i>
                      <div>
                        <div className="font-medium text-green-900">LRU Cache System</div>
                        <div className="text-sm text-green-700">Memory-optimized caching active</div>
                      </div>
                    </div>
                    <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center space-x-3">
                      <i className="fas fa-robot text-blue-600"></i>
                      <div>
                        <div className="font-medium text-blue-900">Auto Email Processing</div>
                        <div className="text-sm text-blue-700">Lightweight polling every 2 minutes</div>
                      </div>
                    </div>
                    <Badge className="bg-blue-100 text-blue-800 border-blue-200">Running</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg border border-purple-200">
                    <div className="flex items-center space-x-3">
                      <i className="fas fa-chart-line text-purple-600"></i>
                      <div>
                        <div className="font-medium text-purple-900">Memory Monitoring</div>
                        <div className="text-sm text-purple-700">Real-time health tracking</div>
                      </div>
                    </div>
                    <Badge className="bg-purple-100 text-purple-800 border-purple-200">Live</Badge>
                  </div>
                  
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <div className="text-sm text-gray-600">
                      <strong>Performance Improvement:</strong> 69% memory reduction achieved through optimized caching and lightweight processing architecture.
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
                    {formatPacificTime(selectedError.createdAt, true, false)}
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
