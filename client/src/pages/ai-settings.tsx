import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Loader2, Settings, Zap, Brain } from "lucide-react";

interface AIEngineConfig {
  classification: 'openai' | 'gemini';
  extraction: 'openai' | 'gemini';
  attachment: 'openai' | 'gemini';
  fallback: 'openai' | 'gemini';
  available: Array<{
    engine: 'openai' | 'gemini';
    available: boolean;
  }>;
}

interface ConnectionResults {
  openai: { success: boolean; error?: string };
  gemini: { success: boolean; error?: string };
  current: string;
}

export default function AISettings() {
  const [testing, setTesting] = useState(false);

  const { data: config, isLoading } = useQuery<AIEngineConfig>({
    queryKey: ['/api/ai/engines'],
    refetchInterval: 30000
  });

  const { data: connectionResults } = useQuery<ConnectionResults>({
    queryKey: ['/api/ai/test'],
    enabled: false
  });

  const setEngineMutation = useMutation({
    mutationFn: async (engine: 'openai' | 'gemini') => {
      const response = await fetch(`/api/ai/engines/${engine}`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai/engines'] });
    }
  });

  const testConnectionsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/ai/test');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai/test'] });
    }
  });

  const handleTestConnections = async () => {
    setTesting(true);
    try {
      await testConnectionsMutation.mutateAsync();
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading AI engine configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Engine Settings</h1>
        <p className="text-muted-foreground">
          Configure and manage AI engines for purchase order processing
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Current Configuration
            </CardTitle>
            <CardDescription>
              AI engines assigned to different processing tasks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-blue-500" />
                  <span className="font-medium">Email Classification</span>
                </div>
                <Badge variant="outline" className="capitalize">
                  {config?.classification || 'Unknown'}
                </Badge>
              </div>

              <div className="flex justify-between items-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-green-500" />
                  <span className="font-medium">Text Extraction</span>
                </div>
                <Badge variant="outline" className="capitalize">
                  {config?.extraction || 'Unknown'}
                </Badge>
              </div>

              <div className="flex justify-between items-center p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border-l-4 border-l-amber-400">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <span className="font-medium">Attachment Processing</span>
                  <Badge variant="secondary" className="ml-2 text-xs">Specialized</Badge>
                </div>
                <Badge variant="outline" className="capitalize bg-amber-100 dark:bg-amber-900">
                  {config?.attachment || 'Unknown'} 2.5 Pro
                </Badge>
              </div>

              <div className="flex justify-between items-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-gray-500" />
                  <span className="font-medium">Fallback Engine</span>
                </div>
                <Badge variant="secondary" className="capitalize">
                  {config?.fallback || 'Unknown'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Engine Availability */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Engine Availability
            </CardTitle>
            <CardDescription>
              Status and availability of AI engines
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {config?.available?.map((engine) => (
              <div key={engine.engine} className="flex justify-between items-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${engine.available ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="font-medium capitalize">
                    {engine.engine === 'openai' ? 'OpenAI GPT-4o' : 'Google Gemini 2.5 Pro'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {engine.available ? (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Available
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Available
                    </Badge>
                  )}
                </div>
              </div>
            ))}


          </CardContent>
        </Card>
      </div>

      {/* Specialized Configuration Notice */}
      <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
        <CardHeader>
          <CardTitle className="text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Optimized Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="text-amber-700 dark:text-amber-300">
          <p className="text-sm">
            <strong>Gemini 2.5 Pro</strong> is specifically configured for PDF attachment processing to provide 
            superior accuracy in extracting purchase order data from complex document formats. This specialized 
            setup ensures optimal performance for your attachment-based purchase orders.
          </p>
          <div className="mt-4 p-3 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
            <p className="text-xs">
              <strong>Processing Flow:</strong> Email Classification → OpenAI GPT-4o | Text Extraction → OpenAI GPT-4o | 
              PDF Attachment Analysis → Gemini 2.5 Pro
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>
            Switch primary engine for classification and text extraction
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Button
              onClick={() => setEngineMutation.mutate('openai')}
              disabled={setEngineMutation.isPending}
              variant={config?.classification === 'openai' ? 'default' : 'outline'}
            >
              Use OpenAI Primary
            </Button>
            <Button
              onClick={() => setEngineMutation.mutate('gemini')}
              disabled={setEngineMutation.isPending}
              variant={config?.classification === 'gemini' ? 'default' : 'outline'}
            >
              Use Gemini Primary
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Note: Attachment processing will always use Gemini 2.5 Pro regardless of primary engine selection.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}