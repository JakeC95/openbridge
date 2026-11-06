import poliigonLogo from "../providers/poliigon.svg";
import megascansLogo from "../providers/megascans.svg";
import polyhavenLogo from "../providers/polyhaven.png";

export type Provider = "megascans" | "poliigon" | "polyhaven";

const PROVIDER_NAME: Record<Provider, string> = {
  megascans: "Megascans",
  poliigon: "Poliigon",
  polyhaven: "Poly Haven"
};

const PROVIDER_LOGO: Record<Provider, string> = {
  megascans: megascansLogo,
  poliigon: poliigonLogo,
  polyhaven: polyhavenLogo
};

/** Small source mark with a neutral tile so every mark reads on dark panels. */
export function ProviderLogo({ provider, className = "" }: { provider: Provider; className?: string }) {
  return (
    <span
      className={`provider-logo ${provider} ${className}`.trim()}
      title={PROVIDER_NAME[provider]}
      aria-label={PROVIDER_NAME[provider]}
      role="img"
    >
      <img src={PROVIDER_LOGO[provider]} alt="" draggable={false} />
    </span>
  );
}

/** Provider logo + name, used in drawer headers. */
export function ProviderTag({ provider }: { provider: Provider }) {
  return (
    <span className={`provider-tag ${provider}`} title={PROVIDER_NAME[provider]}>
      <ProviderLogo provider={provider} />
      <span>{PROVIDER_NAME[provider].toUpperCase()}</span>
    </span>
  );
}
