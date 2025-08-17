import { useState, useEffect } from "react";
import { Mail, Brain, Route, Zap, Search, UserCheck, CheckCircle2, ArrowRight, Filter, ShieldCheck, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface EmailProcessingAnimationProps {
  isProcessing?: boolean;
  processedCount?: number;
  totalCount?: number;
  currentStep?: string;
  currentEmail?: {
    sender?: string;
    subject?: string;
    number?: number;
  };
  finalStatus?: "ready_for_netsuite" | "new_customer" | "pending_review" | "ready_for_extraction" | "pending";
  onAnimationComplete?: () => void;
}

function EmailProcessingAnimation({
  isProcessing = false, 
  processedCount = 0, 
  totalCount = 0,
  currentStep = "",
  currentEmail,
  finalStatus = "pending",
  onAnimationComplete
}: EmailProcessingAnimationProps) {
  
  // Debug logging
  console.log("Animation props:", {
    isProcessing,
    finalStatus,
    currentStep
  });
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [animationKey, setAnimationKey] = useState(0);
  const [internalProcessing, setInternalProcessing] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  
  // Status display mapping
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "ready_for_netsuite":
        return { label: "Ready for NetSuite", description: "✅ Customer found - Ready for import", color: "text-green-600", bgColor: "bg-green-50", borderColor: "border-green-200" };
      case "new_customer": 
        return { label: "New Customer Review", description: "👀 Flagged for CSR review", color: "text-orange-600", bgColor: "bg-orange-50", borderColor: "border-orange-200" };
      case "pending_review":
        return { label: "Pending Review", description: "📝 Manual review required", color: "text-yellow-600", bgColor: "bg-yellow-50", borderColor: "border-yellow-200" };
      case "ready_for_extraction":
        return { label: "Ready for Extraction", description: "📄 Text extraction pending", color: "text-blue-600", bgColor: "bg-blue-50", borderColor: "border-blue-200" };
      default:
        return { label: "Processing Complete", description: "✅ Email processed", color: "text-gray-600", bgColor: "bg-gray-50", borderColor: "border-gray-200" };
    }
  };

  const processingSteps = [
    {
      id: "email",
      icon: "Mail",
      label: "Email Received", 
      description: "Gmail ingestion & labeling",
      status: "pending" as "pending" | "processing" | "completed" | "failed",
      duration: 500
    },
    {
      id: "preprocessing", 
      icon: "Brain",
      label: "Preprocessing",
      description: "OpenAI intent classification",
      status: "pending" as "pending" | "processing" | "completed" | "failed",
      duration: 2500
    },
    {
      id: "classification",
      icon: "Route", 
      label: "Route Classification",
      description: "Advanced gate logic & routing",
      status: "pending" as "pending" | "processing" | "completed" | "failed",
      duration: 1500
    },
    {
      id: "attachment_filter",
      icon: "Filter",
      label: "Attachment Processing",
      description: "Prioritize PO over proof files",
      status: "pending" as "pending" | "processing" | "completed" | "failed",
      duration: 1000
    },
    {
      id: "extraction",
      icon: "Zap",
      label: "Data Extraction",
      description: "Gemini 2.5 Pro PO parsing",
      status: "pending" as "pending" | "processing" | "completed" | "failed", 
      duration: 4000
    },
    {
      id: "customer_lookup",
      icon: "UserCheck",
      label: "Customer Lookup",
      description: "OpenAI customer finder",
      status: "pending" as "pending" | "processing" | "completed" | "failed",
      duration: 2000
    },
    {
      id: "sku_validation",
      icon: "ShieldCheck",
      label: "SKU Validation",
      description: "OpenAI line item validator",
      status: "pending" as "pending" | "processing" | "completed" | "failed",
      duration: 2500
    },
    {
      id: "database_storage",
      icon: "Database",
      label: "Database Storage",
      description: "Save to PostgreSQL",
      status: "pending" as "pending" | "processing" | "completed" | "failed",
      duration: 800
    },
    {
      id: "final_status",
      icon: "CheckCircle2", 
      label: "Status Assignment",
      description: "NetSuite ready or review needed",
      status: "pending" as "pending" | "processing" | "completed" | "failed",
      duration: 500
    }
  ];

  const [steps, setSteps] = useState(processingSteps);

  // Start animation when processing begins
  useEffect(() => {
    if (isProcessing && !internalProcessing) {
      setInternalProcessing(true);
      setShowCompleted(false);
      setCurrentStepIndex(0);
      setSteps(processingSteps.map(step => ({ ...step, status: "pending" as "pending" | "processing" | "completed" | "failed" })));
    }
  }, [isProcessing]);

  // Handle animation progression  
  useEffect(() => {
    if (!internalProcessing) return;

    let timeoutId: NodeJS.Timeout;

    const updateSteps = () => {
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

      // Move to next step or complete
      if (currentStepIndex < processingSteps.length - 1) {
        timeoutId = setTimeout(() => {
          setCurrentStepIndex(prev => prev + 1);
        }, processingSteps[currentStepIndex]?.duration || 1000);
      } else {
        // Mark final step as completed and show real status
        timeoutId = setTimeout(() => {
          setSteps(prevSteps => {
            const finalSteps = [...prevSteps];
            finalSteps[currentStepIndex] = {
              ...finalSteps[currentStepIndex],
              status: "completed"
            };
            return finalSteps;
          });
          
          setShowCompleted(true);
          setInternalProcessing(false);
          
          // Call completion callback if provided
          if (onAnimationComplete) {
            onAnimationComplete();
          }
          
          // Reset animation after showing completed state
          setTimeout(() => {
            setCurrentStepIndex(0);
            setShowCompleted(false);
            setAnimationKey(prev => prev + 1);
          }, 7000); // Stay at completed state longer to show final status
        }, 500);
      }
    };

    updateSteps();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [internalProcessing, currentStepIndex]);

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

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case "Mail": return Mail;
      case "Brain": return Brain;
      case "Route": return Route;
      case "Filter": return Filter;
      case "Zap": return Zap;
      case "Search": return Search;
      case "UserCheck": return UserCheck;
      case "ShieldCheck": return ShieldCheck;
      case "Database": return Database;
      case "CheckCircle2": return CheckCircle2;
      default: return Mail;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Processing Pipeline
          {(isProcessing || internalProcessing) && (
            <Badge variant="secondary" className="animate-pulse">
              {currentEmail ? `Processing Email ${currentEmail.number || processedCount + 1}` : `Processing ${processedCount}/${totalCount}`}
            </Badge>
          )}
          {showCompleted && (
            <Badge variant="default" className={`${getStatusDisplay(finalStatus).color} ${getStatusDisplay(finalStatus).bgColor} border ${getStatusDisplay(finalStatus).borderColor}`}>
              {getStatusDisplay(finalStatus).label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Current Email Display */}
          {(isProcessing || internalProcessing) && currentEmail && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-900">Currently Processing:</span>
              </div>
              <div className="mt-1 ml-6">
                <div className="text-sm text-blue-800">
                  <strong>From:</strong> {currentEmail.sender}
                </div>
                {currentEmail.subject && (
                  <div className="text-sm text-blue-700 mt-1 truncate">
                    <strong>Subject:</strong> {currentEmail.subject}
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Processing Steps */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-3">
            {steps.map((step, index) => {
              const IconComponent = getIcon(step.icon);
              const isActive = step.status === "processing";
              const isCompleted = step.status === "completed";
              
              return (
                <div key={`${step.id}-${animationKey}-${index}`} className="relative">
                  {/* Connection Line */}
                  {index < steps.length - 1 && (
                    <div className="hidden xl:block absolute top-6 left-full w-3 h-0.5 bg-gray-300 z-0">
                      <ArrowRight className="absolute -right-2 -top-2 h-3 w-3 text-gray-400" />
                    </div>
                  )}
                  
                  {/* Step */}
                  <div className={`relative z-10 p-2 rounded-lg border transition-all duration-300 ${
                    isActive 
                      ? "border-blue-500 bg-blue-50 shadow-lg scale-105" 
                      : isCompleted 
                        ? "border-green-500 bg-green-50" 
                        : "border-gray-200 bg-white"
                  }`}>
                    <div className="flex flex-col items-center text-center space-y-1">
                      {/* Icon */}
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center ${getStepStatusColor(step.status)}`}>
                        <IconComponent className={`h-3 w-3 ${
                          step.status === "completed" || step.status === "processing" 
                            ? "text-white" 
                            : "text-gray-600"
                        }`} />
                      </div>
                      
                      {/* Label */}
                      <div>
                        <div className={`text-xs font-medium ${getStepTextColor(step.status)}`}>
                          {step.label}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">
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
          {(isProcessing || internalProcessing) && (
            <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 text-blue-700">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium">
                  {showCompleted ? getStatusDisplay(finalStatus).description : 
                   currentStep || `Processing step ${currentStepIndex + 1} of ${steps.length}`}
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