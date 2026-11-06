export type SizeFilter = "any" | "small" | "medium" | "large" | "huge";

export const SIZE_FILTER_OPTIONS: Array<{ value: SizeFilter; label: string }> = [
  { value: "any", label: "Any physical size" },
  { value: "small", label: "Up to 50 cm" },
  { value: "medium", label: "50 cm – 2 m" },
  { value: "large", label: "2 – 5 m" },
  { value: "huge", label: "5 m and larger" }
];

export const SIZE_FILTER_LABELS: Record<SizeFilter, string> = Object.fromEntries(
  SIZE_FILTER_OPTIONS.map(option => [option.value, option.label])
) as Record<SizeFilter, string>;

export function sizeBounds(value: SizeFilter): { minSize: number | null; maxSize: number | null } {
  if (value === "small") return { minSize: null, maxSize: 0.5 };
  if (value === "medium") return { minSize: 0.5, maxSize: 2 };
  if (value === "large") return { minSize: 2, maxSize: 5 };
  if (value === "huge") return { minSize: 5, maxSize: null };
  return { minSize: null, maxSize: null };
}

/** Maps stored bounds back to the preset that produced them. */
export function sizeFilterFromBounds(minSize: number | null, maxSize: number | null): SizeFilter {
  const match = SIZE_FILTER_OPTIONS.find(option => {
    const bounds = sizeBounds(option.value);
    return bounds.minSize === minSize && bounds.maxSize === maxSize;
  });
  return match?.value ?? "any";
}
