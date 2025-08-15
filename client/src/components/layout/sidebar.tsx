import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const navigationItems = [
  { path: "/", label: "Dashboard", icon: "fas fa-chart-line" },
  { path: "/email-queue", label: "Email Queue", icon: "fas fa-inbox" },
  { path: "/purchase-orders", label: "Purchase Orders", icon: "fas fa-file-invoice" },
  { path: "/error-logs", label: "Error Logs", icon: "fas fa-exclamation-triangle" },
  { path: "/system-status", label: "System Status", icon: "fas fa-cogs" },
  { path: "/analytics", label: "Analytics", icon: "fas fa-chart-bar" },
  { path: "/ai-settings", label: "AI Settings", icon: "fas fa-brain" },
];

export default function Sidebar() {
  const [location] = useLocation();

  return (
    <nav className="fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 z-50">
      <div className="p-6">
        <div className="flex items-center space-x-3 mb-8">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <i className="fas fa-mail-bulk text-white text-sm"></i>
          </div>
          <span className="text-xl font-semibold text-slate-800">PO Processor</span>
        </div>
        
        <ul className="space-y-2">
          {navigationItems.map((item) => (
            <li key={item.path}>
              <Link href={item.path}>
                <a 
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-lg font-medium transition-colors",
                    location === item.path
                      ? "bg-blue-50 text-primary"
                      : "text-secondary hover:bg-gray-50"
                  )}
                >
                  <i className={`${item.icon} w-5`}></i>
                  <span>{item.label}</span>
                </a>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      
      <div className="absolute bottom-0 left-0 right-0 p-6 border-t border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
            <i className="fas fa-user text-gray-600 text-sm"></i>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800">Operations Team</p>
            <p className="text-xs text-secondary">Administrator</p>
          </div>
        </div>
      </div>
    </nav>
  );
}
