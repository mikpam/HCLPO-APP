import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import EmailQueuePage from "@/pages/email-queue";
import PurchaseOrdersPage from "@/pages/purchase-orders";
import ErrorLogsPage from "@/pages/error-logs";
import SystemStatusPage from "@/pages/system-status";
import AnalyticsPage from "@/pages/analytics";
import AISettingsPage from "@/pages/ai-settings";
import FileManagementPage from "@/pages/file-management";
import Sidebar from "@/components/layout/sidebar";

function Router() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="ml-64 min-h-screen">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/email-queue" component={EmailQueuePage} />
          <Route path="/purchase-orders" component={PurchaseOrdersPage} />
          <Route path="/error-logs" component={ErrorLogsPage} />
          <Route path="/system-status" component={SystemStatusPage} />
          <Route path="/analytics" component={AnalyticsPage} />
          <Route path="/ai-settings" component={AISettingsPage} />
          <Route path="/files" component={FileManagementPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
