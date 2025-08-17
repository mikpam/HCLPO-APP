import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Activity, CheckCircle, XCircle, AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { useState } from "react";

interface ValidatorHealthData {
  validatorType: string;
  isHealthy: boolean;
  lastCheckTime: string;
  responseTime: number;
  successRate: number;
  errorCount: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastError?: string;
}

interface SystemHealthData {
  overall: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    healthyValidators: number;
    totalValidators: number;
  };
  validators: ValidatorHealthData[];
  lastUpdated: string;
}

export default function ValidatorHealthPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data: healthData, isLoading, refetch } = useQuery<SystemHealthData>({
    queryKey: ["/api/validator-health/status"],
    refetchInterval: autoRefresh ? 5000 : false, // Refresh every 5 seconds
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'degraded':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'unhealthy':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Clock className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      healthy: "default",
      degraded: "secondary", 
      unhealthy: "destructive"
    } as const;
    
    return (
      <Badge variant={variants[status as keyof typeof variants] || "secondary"}>
        {status.toUpperCase()}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 space-y-6">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Validator Health Monitor</h1>
        </div>
        <div className="grid gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="text-center">Loading health data...</div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Validator Health Monitor</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
            Auto Refresh
          </Button>
          <Button onClick={() => refetch()} variant="outline" size="sm">
            Refresh Now
          </Button>
        </div>
      </div>

      {/* Overall System Health */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {healthData && getStatusIcon(healthData.overall.status)}
            System Health Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          {healthData ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{getStatusBadge(healthData.overall.status)}</div>
                <div className="text-sm text-muted-foreground mt-1">Overall Status</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{healthData.overall.healthyValidators}/{healthData.overall.totalValidators}</div>
                <div className="text-sm text-muted-foreground mt-1">Healthy Validators</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-muted-foreground">Last Updated</div>
                <div className="text-sm font-medium">{new Date(healthData.lastUpdated).toLocaleTimeString()}</div>
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground">No health data available</div>
          )}
        </CardContent>
      </Card>

      {/* Individual Validator Health */}
      <div className="grid gap-4">
        <h2 className="text-xl font-semibold">Validator Details</h2>
        {healthData?.validators.map((validator) => (
          <Card key={validator.validatorType}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon(validator.status)}
                  <span className="capitalize">{validator.validatorType.replace(/([A-Z])/g, ' $1').trim()}</span>
                </div>
                {getStatusBadge(validator.status)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Response Time</div>
                  <div className="font-medium">{validator.responseTime}ms</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Success Rate</div>
                  <div className="font-medium">{(validator.successRate * 100).toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Error Count</div>
                  <div className="font-medium">{validator.errorCount}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Last Check</div>
                  <div className="font-medium text-xs">{new Date(validator.lastCheckTime).toLocaleTimeString()}</div>
                </div>
              </div>
              {validator.lastError && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <div className="text-sm text-muted-foreground mb-2">Last Error</div>
                    <div className="text-sm bg-muted p-2 rounded font-mono">
                      {validator.lastError}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Health Check Information */}
      <Card>
        <CardHeader>
          <CardTitle>Health Monitoring Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-medium mb-2">What This Monitors</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• <strong>Customer Finder:</strong> OpenAI-powered customer matching and lookup performance</li>
              <li>• <strong>Contact Validator:</strong> Contact resolution and validation processing times</li>
              <li>• <strong>SKU Validator:</strong> Product line item validation and SKU processing performance</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium mb-2">Status Indicators</h4>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span><strong>Healthy:</strong> Validator operating normally with good response times</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <span><strong>Degraded:</strong> Validator functional but experiencing slower response times</span>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                <span><strong>Unhealthy:</strong> Validator experiencing errors or failures</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}