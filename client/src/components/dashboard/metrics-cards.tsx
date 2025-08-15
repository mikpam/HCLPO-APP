import { DashboardMetrics } from "@/types";

interface MetricsCardsProps {
  metrics: DashboardMetrics;
  isLoading: boolean;
}

export default function MetricsCards({ metrics, isLoading }: MetricsCardsProps) {
  const cards = [
    {
      title: "Emails Processed Today",
      value: metrics.emailsProcessedToday,
      icon: "fas fa-envelope",
      change: "+12%",
      changeType: "positive" as const,
      bgColor: "bg-blue-50",
      iconColor: "text-primary"
    },
    {
      title: "POs Successfully Processed",
      value: metrics.posProcessed,
      icon: "fas fa-check-circle",
      change: "+8%",
      changeType: "positive" as const,
      bgColor: "bg-green-50",
      iconColor: "text-success"
    },
    {
      title: "Pending Review",
      value: metrics.pendingReview,
      icon: "fas fa-clock",
      change: "+3",
      changeType: "warning" as const,
      bgColor: "bg-amber-50",
      iconColor: "text-warning"
    },
    {
      title: "Processing Errors",
      value: metrics.processingErrors,
      icon: "fas fa-exclamation-triangle",
      change: "-2",
      changeType: "negative" as const,
      bgColor: "bg-red-50",
      iconColor: "text-error"
    }
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
              <div className="w-12 h-4 bg-gray-200 rounded"></div>
            </div>
            <div className="w-16 h-8 bg-gray-200 rounded mb-2"></div>
            <div className="w-32 h-4 bg-gray-200 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {cards.map((card, index) => (
        <div key={index} className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 ${card.bgColor} rounded-lg flex items-center justify-center`}>
              <i className={`${card.icon} ${card.iconColor}`}></i>
            </div>
            <span 
              className={`text-sm font-medium ${
                card.changeType === 'positive' ? 'text-success' : 
                card.changeType === 'warning' ? 'text-warning' : 
                'text-error'
              }`}
            >
              {card.change}
            </span>
          </div>
          <h3 className="text-2xl font-bold text-slate-800">{card.value}</h3>
          <p className="text-secondary text-sm">{card.title}</p>
        </div>
      ))}
    </div>
  );
}
