import { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "warning" | "success" | "destructive";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default: "bg-gray-100 text-gray-700",
    warning: "bg-amber-100 text-amber-700",
    success: "bg-green-100 text-green-700",
    destructive: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", variants[variant], className)}
      {...props}
    />
  );
}
