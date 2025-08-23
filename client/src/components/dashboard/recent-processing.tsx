import { useQuery } from "@tanstack/react-query";
import { RecentEmailItem } from "@/types";
import { formatPacificTimeOnly } from "@/lib/pacific-time";

export default function RecentProcessing() {
  const { data: recentEmails, isLoading } = useQuery<RecentEmailItem[]>({
    queryKey: ["/api/email-queue"],
    queryFn: async () => {
      const response = await fetch("/api/email-queue?limit=10");
      if (!response.ok) throw new Error("Failed to fetch recent emails");
      return response.json();
    },
    refetchInterval: 5000 // Refresh every 5 seconds to show live processing updates
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processed':
        return 'bg-green-100 text-success';
      case 'pending':
        return 'bg-amber-100 text-warning';
      case 'error':
        return 'bg-red-100 text-error';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const getEmailIcon = (route: string) => {
    switch (route) {
      case 'TEXT_PO':
        return { icon: 'fas fa-envelope', color: 'text-primary', bg: 'bg-blue-100' };
      case 'ATTACHMENT_PO':
        return { icon: 'fas fa-paperclip', color: 'text-warning', bg: 'bg-amber-100' };
      case 'REVIEW':
        return { icon: 'fas fa-exclamation-triangle', color: 'text-error', bg: 'bg-red-100' };
      default:
        return { icon: 'fas fa-envelope', color: 'text-gray-500', bg: 'bg-gray-100' };
    }
  };

  if (isLoading) {
    return (
      <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-slate-800">Recent Email Processing</h2>
        </div>
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center space-x-4">
                <div className="w-8 h-8 bg-gray-200 rounded-lg"></div>
                <div className="flex-1">
                  <div className="w-48 h-4 bg-gray-200 rounded mb-1"></div>
                  <div className="w-32 h-3 bg-gray-200 rounded"></div>
                </div>
                <div className="w-16 h-6 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Recent Email Processing</h2>
          <button className="text-primary hover:text-blue-600 text-sm font-medium">View All</button>
        </div>
      </div>
      
      <div className="overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Route</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Confidence</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {recentEmails?.map((email) => {
              const iconData = getEmailIcon(email.route);
              return (
                <tr key={email.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className={`w-8 h-8 ${iconData.bg} rounded-lg flex items-center justify-center mr-3`}>
                        <i className={`${iconData.icon} ${iconData.color} text-sm`}></i>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{email.sender}</p>
                        <p className="text-xs text-secondary">{email.subject}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(email.status)}`}>
                      {email.status.charAt(0).toUpperCase() + email.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-800">{email.route}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <div className="w-12 bg-gray-200 rounded-full h-2 mr-2">
                        <div 
                          className={`h-2 rounded-full ${
                            email.confidence >= 0.8 ? 'bg-success' : 
                            email.confidence >= 0.6 ? 'bg-warning' : 
                            'bg-error'
                          }`}
                          style={{ width: `${email.confidence * 100}%` }}
                        ></div>
                      </div>
                      <span className="text-sm text-slate-800">{Math.round(email.confidence * 100)}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-secondary">
                    {formatPacificTimeOnly(email.processedAt, false)}
                  </td>
                </tr>
              );
            })}
            {(!recentEmails || recentEmails.length === 0) && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  No recent email processing activity
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
