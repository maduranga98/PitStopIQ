export declare const INSPECTION_PERMISSION_KEYS: readonly string[];
export declare const INSPECTION_DEFAULTS: Record<string, Record<string, boolean>>;
export declare function inspectionPermission(
  ctx: {
    role: string;
    isPro: boolean;
    customRole?: { permissions?: { inspectionReports?: Record<string, boolean> } } | null;
    rolePermissions?: Record<string, { inspectionReports?: Record<string, boolean> } | undefined> | null;
  },
  key: string,
): boolean;
