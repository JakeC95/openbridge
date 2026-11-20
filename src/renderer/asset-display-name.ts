/** Display pipeline words with their capitalization and readable spacing. */
export function assetDisplayName(value: string): string {
  const words = value.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2").match(/[\p{L}\p{N}]+/gu);
  if (!words?.length) return value;
  return words.map(word => word.charAt(0).toLocaleUpperCase() + word.slice(1)).join(" ");
}
