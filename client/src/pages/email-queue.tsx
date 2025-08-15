import { useQuery } from "@tanstack/react-query";
import { EmailQueue } from "@shared/schema";
import { Button } from "@/components/ui/button";

export default function EmailQueuePage() {
  const { data: emailQueue, isLoading } = useQuery<EmailQueue[]>({
    queryKey: ["/api/email-queue"],
    refetchInterval: false // Disabled automatic refresh for manual tracing
  });

  const handleProcessEmails = async () => {
    alert('Batch processing disabled. Use the single email processing button on the dashboard instead.');
    // Disabled for manual tracing - use single email processing instead
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processed':
        return 'bg-green-100 text-success';
      case 'processing':
        return 'bg-blue-100 text-primary';
      case 'pending':
        return 'bg-amber-100 text-warning';
      case 'error':
        return 'bg-red-100 text-error';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Email Queue</h1>
            <p className="text-secondary mt-1">Monitor and process incoming purchase order emails</p>
          </div>
          <Button onClick={handleProcessEmails} disabled>
            <i className="fas fa-sync mr-2"></i>
            Batch Processing Disabled
          </Button>
        </div>
      </header>

      <div className="p-8">
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Classification</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Attachments</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider">Processed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4">
                        <div className="animate-pulse">
                          <div className="w-48 h-4 bg-gray-200 rounded mb-1"></div>
                          <div className="w-32 h-3 bg-gray-200 rounded"></div>
                        </div>
                      </td>
                      <td className="px-6 py-4"><div className="w-16 h-6 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-8 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                      <td className="px-6 py-4"><div className="w-24 h-4 bg-gray-200 rounded animate-pulse"></div></td>
                    </tr>
                  ))
                ) : emailQueue && emailQueue.length > 0 ? (
                  emailQueue.map((email) => (
                    <tr key={email.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-sm font-medium text-slate-800">{email.sender}</p>
                          <p className="text-xs text-secondary">{email.subject}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(email.status)}`}>
                          {email.status.charAt(0).toUpperCase() + email.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-800">
                        {email.classificationResult ? 
                          (email.classificationResult as any).recommended_route : 
                          'Pending'
                        }
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-800">
                        {email.attachments ? (email.attachments as any[]).length : 0}
                      </td>
                      <td className="px-6 py-4 text-sm text-secondary">
                        {email.processedAt ? 
                          new Date(email.processedAt).toLocaleString() : 
                          'Not processed'
                        }
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                      No emails in queue
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
