import type { DownloadDiagnostics, DownloadSource } from "../shared/types";

type Place = readonly [location: string, country: string, countryCode: string];

// These are advertised CDN airport/POP codes, not an IP geolocation database or an origin claim.
const EDGE_LOCATIONS: Record<string, Place> = {
  LHR: ["London, UK", "United Kingdom", "gb"], MAN: ["Manchester, UK", "United Kingdom", "gb"],
  DUB: ["Dublin, Ireland", "Ireland", "ie"],
  AMS: ["Amsterdam, Netherlands", "Netherlands", "nl"], FRA: ["Frankfurt, Germany", "Germany", "de"],
  CDG: ["Paris, France", "France", "fr"], MAD: ["Madrid, Spain", "Spain", "es"],
  LIS: ["Lisbon, Portugal", "Portugal", "pt"], MXP: ["Milan, Italy", "Italy", "it"],
  FCO: ["Rome, Italy", "Italy", "it"], ZRH: ["Zurich, Switzerland", "Switzerland", "ch"],
  VIE: ["Vienna, Austria", "Austria", "at"], PRG: ["Prague, Czechia", "Czechia", "cz"],
  WAW: ["Warsaw, Poland", "Poland", "pl"], ARN: ["Stockholm, Sweden", "Sweden", "se"],
  HEL: ["Helsinki, Finland", "Finland", "fi"], CPH: ["Copenhagen, Denmark", "Denmark", "dk"],
  OSL: ["Oslo, Norway", "Norway", "no"],
  IAD: ["Northern Virginia, US", "United States", "us"], EWR: ["Newark, US", "United States", "us"],
  JFK: ["New York, US", "United States", "us"], BOS: ["Boston, US", "United States", "us"],
  ORD: ["Chicago, US", "United States", "us"], ATL: ["Atlanta, US", "United States", "us"],
  MIA: ["Miami, US", "United States", "us"], DFW: ["Dallas, US", "United States", "us"],
  IAH: ["Houston, US", "United States", "us"], DEN: ["Denver, US", "United States", "us"],
  PHX: ["Phoenix, US", "United States", "us"], LAX: ["Los Angeles, US", "United States", "us"],
  SFO: ["San Francisco, US", "United States", "us"], SJC: ["San Jose, US", "United States", "us"],
  SEA: ["Seattle, US", "United States", "us"], PDX: ["Portland, US", "United States", "us"],
  MSP: ["Minneapolis, US", "United States", "us"], DTW: ["Detroit, US", "United States", "us"],
  SLC: ["Salt Lake City, US", "United States", "us"],
  YYZ: ["Toronto, Canada", "Canada", "ca"], YUL: ["Montreal, Canada", "Canada", "ca"],
  YVR: ["Vancouver, Canada", "Canada", "ca"],
  SIN: ["Singapore", "Singapore", "sg"], HKG: ["Hong Kong", "Hong Kong", "hk"],
  NRT: ["Tokyo, Japan", "Japan", "jp"], HND: ["Tokyo, Japan", "Japan", "jp"],
  KIX: ["Osaka, Japan", "Japan", "jp"], ICN: ["Seoul, South Korea", "South Korea", "kr"],
  TPE: ["Taipei, Taiwan", "Taiwan", "tw"],
  BOM: ["Mumbai, India", "India", "in"], BLR: ["Bengaluru, India", "India", "in"],
  DEL: ["Delhi, India", "India", "in"], MAA: ["Chennai, India", "India", "in"],
  HYD: ["Hyderabad, India", "India", "in"],
  DXB: ["Dubai, UAE", "United Arab Emirates", "ae"], BAH: ["Bahrain", "Bahrain", "bh"],
  TLV: ["Tel Aviv, Israel", "Israel", "il"],
  SYD: ["Sydney, Australia", "Australia", "au"], MEL: ["Melbourne, Australia", "Australia", "au"],
  PER: ["Perth, Australia", "Australia", "au"], AKL: ["Auckland, New Zealand", "New Zealand", "nz"],
  GRU: ["São Paulo, Brazil", "Brazil", "br"], GIG: ["Rio de Janeiro, Brazil", "Brazil", "br"],
  SCL: ["Santiago, Chile", "Chile", "cl"], BOG: ["Bogotá, Colombia", "Colombia", "co"],
  EZE: ["Buenos Aires, Argentina", "Argentina", "ar"], MEX: ["Mexico City, Mexico", "Mexico", "mx"],
  JNB: ["Johannesburg, South Africa", "South Africa", "za"],
  CPT: ["Cape Town, South Africa", "South Africa", "za"], NBO: ["Nairobi, Kenya", "Kenya", "ke"]
};

const REGIONS: Record<string, Place> = {
  "us-east-1": ["Northern Virginia, US", "United States", "us"],
  "us-east-2": ["Ohio, US", "United States", "us"],
  "us-west-1": ["Northern California, US", "United States", "us"],
  "us-west-2": ["Oregon, US", "United States", "us"],
  "eu-west-1": ["Ireland", "Ireland", "ie"], "eu-west-2": ["London, UK", "United Kingdom", "gb"],
  "eu-west-3": ["Paris, France", "France", "fr"],
  "eu-central-1": ["Frankfurt, Germany", "Germany", "de"],
  "eu-north-1": ["Stockholm, Sweden", "Sweden", "se"],
  "ap-southeast-1": ["Singapore", "Singapore", "sg"],
  "ap-southeast-2": ["Sydney, Australia", "Australia", "au"],
  "ap-northeast-1": ["Tokyo, Japan", "Japan", "jp"],
  "ap-northeast-2": ["Seoul, South Korea", "South Korea", "kr"],
  "ap-south-1": ["Mumbai, India", "India", "in"],
  "sa-east-1": ["São Paulo, Brazil", "Brazil", "br"],
  "ca-central-1": ["Central Canada", "Canada", "ca"],
  "af-south-1": ["Cape Town, South Africa", "South Africa", "za"]
};

function applyPlace(source: DownloadSource, place: Place | undefined): void {
  if (!place) return;
  source.location = place[0];
  source.country = place[1];
  source.countryCode = place[2];
}

export function downloadSource(url: string, headers: Headers): DownloadSource {
  const source: DownloadSource = { host: new URL(url).host };
  const cloudfront = headers.get("x-amz-cf-pop")?.trim().toUpperCase();
  const cloudflare = headers.get("cf-ray")?.trim().match(/-([A-Z]{3})$/i)?.[1]?.toUpperCase();
  const fastly = headers.get("x-served-by")?.split(",").at(-1)?.trim().match(/-([A-Z]{3})$/)?.[1];
  if (cloudfront && /^[A-Z]{3}\d{0,3}(?:-[A-Z0-9]+)?$/.test(cloudfront)) {
    source.provider = "CloudFront"; source.edgeCode = cloudfront;
  } else if (cloudflare) { source.provider = "Cloudflare"; source.edgeCode = cloudflare; }
  else if (fastly) { source.provider = "Fastly"; source.edgeCode = fastly; }
  if (source.edgeCode) {
    source.locationKind = "edge";
    applyPlace(source, EDGE_LOCATIONS[source.edgeCode.slice(0, 3)]);
  } else {
    const region = headers.get("x-amz-bucket-region")?.trim();
    if (region && /^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) {
      source.provider = "Amazon S3"; source.edgeCode = region;
      source.locationKind = "region";
      applyPlace(source, REGIONS[region]);
    }
  }
  if (!source.provider) {
    const server = headers.get("server") ?? "";
    if (/cloudfront/i.test(server)) source.provider = "CloudFront";
    else if (/cloudflare/i.test(server)) source.provider = "Cloudflare";
    else if (/amazons3/i.test(server)) source.provider = "Amazon S3";
  }
  return source;
}

export interface TransferTelemetry {
  receivedBytes: number;
  writtenBytes: number;
  active: boolean;
  source: DownloadSource;
}

export class DownloadStats {
  private readonly started: number;
  private samples: Array<{ time: number; received: number; written: number }> = [];
  private active = new Map<string, DownloadSource>();
  private recent = new Map<string, DownloadSource>();
  constructor(private readonly now: () => number = () => performance.now()) { this.started = now(); }

  record(file: string, sample: TransferTelemetry): void {
    const time = this.now();
    if (sample.receivedBytes > 0 || sample.writtenBytes > 0) this.samples.push({
      time, received: Math.max(0, sample.receivedBytes), written: Math.max(0, sample.writtenBytes)
    });
    if (sample.active) this.active.set(file, sample.source);
    else this.active.delete(file);
    const key = this.sourceKey(sample.source);
    this.recent.delete(key); this.recent.set(key, sample.source);
    if (this.recent.size > 8) this.recent.delete(this.recent.keys().next().value!);
    this.prune(time);
  }

  snapshot(live = true): DownloadDiagnostics {
    const time = this.now(); this.prune(time);
    // Divide the trailing window by the window actually observed, not total job lifetime, so a
    // healthy long download does not look progressively slower.
    const seconds = Math.min(3, Math.max(0.25, (time - this.started) / 1000));
    const sources = new Map<string, DownloadSource>();
    for (const source of this.active.size ? this.active.values() : this.recent.values()) sources.set(this.sourceKey(source), { ...source });
    const active = live ? this.active.size : 0;
    return {
      receiveBytesPerSecond: active ? this.samples.reduce((sum, sample) => sum + sample.received, 0) / seconds : 0,
      writeBytesPerSecond: active ? this.samples.reduce((sum, sample) => sum + sample.written, 0) / seconds : 0,
      activeTransfers: active,
      sources: [...sources.values()]
    };
  }
  private sourceKey(source: DownloadSource): string { return `${source.host}:${source.edgeCode ?? ""}`; }
  private prune(time: number): void { this.samples = this.samples.filter(sample => sample.time > time - 3000); }
}
