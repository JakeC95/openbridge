/** Environment only; weather/time remain independent dimensions. */
export function publicHdriCategory(name: string, tags: string[]): string {
  const words = `${name} ${tags.join(" ")}`.toLowerCase().replace(/[_-]+/g, " ");
  if (/\bstudio\b/.test(words)) return "HDRIs/Studio";
  if (/\bindoor\b|\binterior\b/.test(words)) return "HDRIs/Interiors";
  const environments: Array<[RegExp, string]> = [
    [/\bindustrial\b|\bfactory\b|\bwarehouse\b/, "Industrial"],
    [/\babandoned\b|\bruins?\b|\bderelict\b/, "Abandoned & Ruins"],
    [/\bstreets?\b|\btown\b|\burban\b|\bcity\b|\bsquare\b|\bbuildings?\b/, "Streets & Town"],
    [/\bforest\b|\bwoodland\b|\bwoods\b/, "Forest & Woodland"],
    [/\bmountains?\b|\bhills?\b|\balpine\b/, "Mountains & Hills"],
    [/\bcoast\b|\bbeach\b|\bocean\b|\blake\b|\briver\b|\bwaterfront\b/, "Coast & Water"],
    [/\bdesert\b|\barid\b|\bdunes?\b/, "Desert & Arid"],
    [/\bparks?\b|\bgardens?\b/, "Parks & Gardens"],
    [/\bfields?\b|\bcountryside\b|\bmeadow\b|\bfarmland\b|\bpasture\b/, "Fields & Countryside"]
  ];
  const match = environments.find(([pattern]) => pattern.test(words));
  const skyName = /\bsky\b|\bskies\b|pure[-_ ]?sky/i.test(name);
  const skyTag = tags.some(tag => /^(pure[-_ ]?)?sky|skies$/i.test(tag));
  if ((skyName || skyTag) && !match) return "HDRIs/Skies";
  return match ? `HDRIs/Outdoor/${match[1]}` : "HDRIs/Outdoor/General";
}
