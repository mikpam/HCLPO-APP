import { useState, useEffect } from "react";
import { Mail, Brain, Route, Zap, Search, UserCheck, CheckCircle2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface EmailProcessingAnimationProps {
  isProcessing?: boolean;
  processedCount?: number;
  totalCount?: number;
  currentStep?: string;
}

function EmailProcessingAnimation({ 
  isProcessing = false, 
  processedCount = 0, 
  totalCount = 0,
  currentStep = ""
}: EmailProcessingAnimationProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [animationKey, setAnimationKey] = useState(0);

  const processingSteps = [
    {
      id: "email",
      icon: Mail,
      label: "Email Received",
      description: "New email detected",
      status: "pending",
      duration: 500
    },
    {
      id: "preprocessing", 
      icon: Brain,
      label: "Preprocessing",
      description: "OpenAI classification",
      status: "pending",
      duration: 2000
    },
    {
      id: "routing",
      icon: Route,
      label: "Route Classification",
      description: "Determining processing path",
      status: "pending", 
      duration: 1000
    },
    {
      id: "extraction",
      icon: Zap,
      label: "Data Extraction",
      description: "Gemini PO parsing",
      status: "pending",
      duration: 3000
    },
    {
      id: "parsing",
      icon: Search,
      label: "Data Parsing", 
      description: "Structuring information",
      status: "pending",
      duration: 1500
    },
    {
      id: "customer",
      icon: UserCheck,
      label: "Customer ID",
      description: "HCL database lookup",
      status: "pending",
      duration: 1000
    },
    {
      id: "ready",
      icon: CheckCircle2,
      label: "Ready for NetSuite",
      description: "Processing complete",
      status: "pending",
      duration: 500
    }
  ];

  const [steps, setSteps] = useState(processingSteps);

  useEffect(() => {
    if (!isProcessing) {
      setSteps(processingSteps);
      setCurrentStepIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setSteps(prevSteps => {
        const newSteps = [...prevSteps];
        
        // Mark current step as processing
        if (currentStepIndex < newSteps.length) {
          newSteps[currentStepIndex] = {
            ...newSteps[currentStepIndex],
            status: "processing"
          };
        }

        // Mark previous steps as completed
        for (let i = 0; i < currentStepIndex; i++) {
          newSteps[i] = {
            ...newSteps[i],
            status: "completed"
          };
        }

        return newSteps;
      });

      if (currentStepIndex < processingSteps.length - 1) {
        setTimeout(() => {
          setCurrentStepIndex(prev => prev + 1);
        }, processingSteps[currentStepIndex]?.duration || 1000);
      } else {
        // Animation complete, reset for next email
        setTimeout(() => {
          setCurrentStepIndex(0);
          setAnimationKey(prev => prev + 1);
        }, 2000);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isProcessing, currentStepIndex, animationKey]);

  const getStepStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-500";
      case "processing": return "bg-blue-500 animate-pulse"; 
      case "failed": return "bg-red-500";
      default: return "bg-gray-300";
    }
  };

  const getStepTextColor = (status: string) => {
    switch (status) {
      case "completed": return "text-green-700";
      case "processing": return "text-blue-700 font-semibold";
      case "failed": return "text-red-700";
      default: return "text-gray-500";
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Processing Pipeline
          {isProcessing && (
            <Badge variant="secondary" className="animate-pulse">
              Processing {processedCount}/{totalCount}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Processing Steps */}
          <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = step.status === "processing";
              const isCompleted = step.status === "completed";
              
              return (
                <div key={`${step.id}-${animationKey}`} className="relative">
                  {/* Connection Line */}
                  {index < steps.length - 1 && (
                    <div className="hidden md:block absolute top-6 left-full w-4 h-0.5 bg-gray-300 z-0">
                      <ArrowRight className="absolute -right-2 -top-2 h-4 w-4 text-gray-400" />
                    </div>
                  )}
                  
                  {/* Step */}
                  <div className={`relative z-10 p-3 rounded-lg border transition-all duration-300 ${
                    isActive 
                      ? "border-blue-500 bg-blue-50 shadow-lg scale-105" 
                      : isCompleted 
                        ? "border-green-500 bg-green-50" 
                        : "border-gray-200 bg-white"
                  }`}>
                    <div className="flex flex-col items-center text-center space-y-2">
                      {/* Icon */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getStepStatusColor(step.status)}`}>
                        <Icon className={`h-4 w-4 ${
                          step.status === "completed" || step.status === "processing" 
                            ? "text-white" 
                            : "text-gray-600"
                        }`} />
                      </div>
                      
                      {/* Label */}
                      <div>
                        <div className={`text-sm font-medium ${getStepTextColor(step.status)}`}>
                          {step.label}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {step.description}
                        </div>
                      </div>
                      
                      {/* Processing indicator */}
                      {isActive && (
                        <div className="flex space-x-1">
                          <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce"></div>
                          <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                          <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Current Status */}
          {isProcessing && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 text-blue-700">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium">
                  {currentStep || `Processing step ${currentStepIndex + 1} of ${steps.length}`}
                </span>
              </div>
              
              {/* Progress bar */}
              <div className="mt-2 w-full bg-blue-200 rounded-full h-1.5">
                <div 
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Processing Stats */}
          {(processedCount > 0 || totalCount > 0) && (
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div className="text-center p-2 bg-gray-50 rounded">
                <div className="text-lg font-semibold text-gray-900">{processedCount}</div>
                <div className="text-xs text-gray-500">Processed</div>
              </div>
              <div className="text-center p-2 bg-gray-50 rounded">
                <div className="text-lg font-semibold text-gray-900">{totalCount}</div>
                <div className="text-xs text-gray-500">Total</div>
              </div>
              <div className="text-center p-2 bg-gray-50 rounded">
                <div className="text-lg font-semibold text-gray-900">
                  {totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0}%
                </div>
                <div className="text-xs text-gray-500">Complete</div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default EmailProcessingAnimation;