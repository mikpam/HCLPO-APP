import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useLayoutSidebar } from "@/contexts/sidebar-context";

const navigationItems = [
  { path: "/", label: "Dashboard", icon: "fas fa-chart-line" },
  { path: "/email-queue", label: "Email Queue", icon: "fas fa-inbox" },
  { path: "/purchase-orders", label: "Purchase Orders", icon: "fas fa-file-invoice" },

  { path: "/customers", label: "Customer Directory", icon: "fas fa-address-book" },
  { path: "/items", label: "Items Management", icon: "fas fa-boxes" },
  { path: "/files", label: "File Management", icon: "fas fa-folder-open" },
  { path: "/error-logs", label: "Error Logs", icon: "fas fa-exclamation-triangle" },
  { path: "/system-status", label: "System Status", icon: "fas fa-cogs" },
  { path: "/analytics", label: "Analytics", icon: "fas fa-chart-bar" },
  { path: "/ai-settings", label: "AI Settings", icon: "fas fa-brain" },
];

export default function Sidebar() {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { isCollapsed, setIsCollapsed } = useLayoutSidebar();

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <i className="fas fa-mail-bulk text-white text-sm"></i>
            </div>
            <span className="text-lg font-semibold text-slate-800">PO Processor</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <nav className={cn(
        "fixed top-0 h-full bg-white border-r border-gray-200 z-50 transition-all duration-300",
        "lg:translate-x-0", // Always visible on desktop
        isCollapsed ? "lg:w-16" : "lg:w-64", // Collapsible width on desktop
        "w-64", // Full width on mobile
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0" // Hidden on mobile unless menu is open
      )}>
        <div className="p-6 pt-20 lg:pt-6 relative">
          {/* Desktop Collapse Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              "hidden lg:flex absolute -right-3 top-8 w-6 h-6 p-0 rounded-full bg-white border border-gray-200 shadow-sm hover:shadow-md z-10",
              isCollapsed && "top-6"
            )}
          >
            {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
          </Button>

          {/* Desktop Logo */}
          <div className={cn(
            "hidden lg:flex items-center mb-8 transition-all duration-300",
            isCollapsed ? "justify-center" : "space-x-3"
          )}>
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <i className="fas fa-mail-bulk text-white text-sm"></i>
            </div>
            {!isCollapsed && (
              <span className="text-xl font-semibold text-slate-800 whitespace-nowrap">PO Processor</span>
            )}
          </div>
          
          <ul className="space-y-2">
            {navigationItems.map((item) => (
              <li key={item.path}>
                <Link href={item.path}>
                  <div 
                    className={cn(
                      "flex items-center px-3 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer",
                      isCollapsed ? "justify-center lg:space-x-0" : "space-x-3",
                      location === item.path
                        ? "bg-blue-50 text-primary"
                        : "text-secondary hover:bg-gray-50"
                    )}
                    onClick={() => setIsMobileMenuOpen(false)} // Close mobile menu on navigation
                    title={isCollapsed ? item.label : undefined} // Tooltip for collapsed state
                  >
                    <i className={`${item.icon} w-5 flex-shrink-0`}></i>
                    <span className={cn(
                      "whitespace-nowrap transition-opacity duration-200",
                      "lg:block",
                      isCollapsed && "lg:hidden"
                    )}>{item.label}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        
        <div className="absolute bottom-0 left-0 right-0 p-6 border-t border-gray-200">
          <div className={cn(
            "flex items-center transition-all duration-300",
            isCollapsed ? "justify-center lg:space-x-0" : "space-x-3"
          )}>
            <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
              <i className="fas fa-user text-gray-600 text-sm"></i>
            </div>
            <div className={cn(
              "transition-opacity duration-200 lg:block",
              isCollapsed && "lg:hidden"
            )}>
              <p className="text-sm font-medium text-slate-800 whitespace-nowrap">Operations Team</p>
              <p className="text-xs text-secondary whitespace-nowrap">Administrator</p>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
