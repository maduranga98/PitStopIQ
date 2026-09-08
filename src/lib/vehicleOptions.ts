// Shared default option lists for oil brands, oil grades and vehicle types.
// Centers can extend these with their own custom values, stored on the
// service-center document as customOilBrands / customOilGrades /
// customVehicleTypes. Keeping the defaults in one place lets the vehicle
// form and the service price catalog stay in sync.
export const DEFAULT_OIL_BRANDS = ["Castrol", "Mobil", "Shell", "Caltex", "Elf", "Total", "SinoPec"];
export const DEFAULT_OIL_GRADES = ["5W-30", "10W-40", "15W-40", "0W-20", "5W-20"];
export const DEFAULT_VEHICLE_TYPES = ["car", "van", "lorry", "motor bike"];

// Vehicle types a center has removed from the service catalog, stored on the
// service-center document as hiddenVehicleTypes. Built-in types can't be
// deleted from the defaults list, so they are hidden instead — and a type is
// unhidden simply by adding it again.
export function withoutHiddenTypes(types: Iterable<string>, hidden: string[] = []): string[] {
  const skip = new Set(hidden.map((t) => t.trim().toLowerCase()));
  return Array.from(new Set(types))
    .filter((t) => !skip.has(t.trim().toLowerCase()))
    .sort();
}
