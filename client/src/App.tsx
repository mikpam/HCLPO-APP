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

import CustomersPage from "@/pages/customers";
import ContactsPage from "@/pages/contacts";
import ItemsPage from "@/pages/items";
import CompanyAnalysisPage from "@/pages/company-analysis";
import Sidebar from "@/components/layout/sidebar";
import { SidebarProvider, useLayoutSidebar } from "@/contexts/sidebar-context";

function Router() {
  const { isCollapsed } = useLayoutSidebar();
  
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className={`min-h-screen pt-16 lg:pt-0 transition-all duration-300 ${
        isCollapsed ? 'lg:ml-16' : 'lg:ml-64'
      }`}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/email-queue" component={EmailQueuePage} />
          <Route path="/purchase-orders" component={PurchaseOrdersPage} />
          <Route path="/error-logs" component={ErrorLogsPage} />
          <Route path="/system-status" component={SystemStatusPage} />
          <Route path="/analytics" component={AnalyticsPage} />
          <Route path="/ai-settings" component={AISettingsPage} />
          <Route path="/files" component={FileManagementPage} />
          <Route path="/customers" component={CustomersPage} />
          <Route path="/contacts" component={ContactsPage} />
          <Route path="/items" component={ItemsPage} />
          <Route path="/company-analysis" component={CompanyAnalysisPage} />
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
        <SidebarProvider>
          <Toaster />
          <Router />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
