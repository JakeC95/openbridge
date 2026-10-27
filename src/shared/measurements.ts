function trimNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function formatMeasurementText(value: string | null | undefined): string {
  if (!value) return "";
  const text = value.trim();
  if (!text || /px\s*\/|\bpx\b|%/.test(text)) return text;

  const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map(match =>
    Number.parseFloat(match[1])
  );
  if (numbers.length === 0) return text;

  const hasUnit = /\bm\b/i.test(text);
  if (!hasUnit && !/[\d.]/.test(text)) return text;

  const useCentimeters = numbers.some(number => number < 1);
  const unit = useCentimeters ? "cm" : "m";
  const scale = useCentimeters ? 100 : 1;
  const formatted = numbers.map(number => trimNumber(number * scale));

  if (numbers.length > 1 && /[x×]/i.test(text)) {
    return `${formatted.join(" x ")} ${unit}`;
  }
  if (numbers.length > 1 && /[-–]/.test(text)) {
    return `${formatted.join("-")} ${unit}`;
  }
  return `${formatted[0]} ${unit}`;
}
