import type { ReactNode } from "react";

interface PageHeaderProps {
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  /** Optional content rendered below the title row (filter bars, tabs, etc.) */
  below?: ReactNode;
}

export default function PageHeader({ icon, title, actions, below }: PageHeaderProps) {
  return (
    <div className="border-b border-white/10 bg-[#0B1120]/90 backdrop-blur sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-3">
        <span className="text-[#F97316] flex-shrink-0">{icon}</span>
        <h1 className="text-lg font-bold text-white flex-1">{title}</h1>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
        )}
      </div>
      {below}
    </div>
  );
}
