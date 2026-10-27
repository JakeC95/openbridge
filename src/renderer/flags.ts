// Country flags from flag-icons 7.6.0 (MIT, https://github.com/lipis/flag-icons).
// Only the 4x3 SVGs for CDN/region countries reported by download servers are bundled.
// The licence text ships alongside the assets in ./flags/LICENSE.
import ae from "./flags/ae.svg";
import ar from "./flags/ar.svg";
import at from "./flags/at.svg";
import au from "./flags/au.svg";
import bh from "./flags/bh.svg";
import br from "./flags/br.svg";
import ca from "./flags/ca.svg";
import ch from "./flags/ch.svg";
import cl from "./flags/cl.svg";
import co from "./flags/co.svg";
import cz from "./flags/cz.svg";
import de from "./flags/de.svg";
import dk from "./flags/dk.svg";
import es from "./flags/es.svg";
import fi from "./flags/fi.svg";
import fr from "./flags/fr.svg";
import gb from "./flags/gb.svg";
import hk from "./flags/hk.svg";
import ie from "./flags/ie.svg";
import il from "./flags/il.svg";
import inFlag from "./flags/in.svg";
import it from "./flags/it.svg";
import jp from "./flags/jp.svg";
import ke from "./flags/ke.svg";
import kr from "./flags/kr.svg";
import mx from "./flags/mx.svg";
import nl from "./flags/nl.svg";
import no from "./flags/no.svg";
import nz from "./flags/nz.svg";
import pl from "./flags/pl.svg";
import pt from "./flags/pt.svg";
import se from "./flags/se.svg";
import sg from "./flags/sg.svg";
import tw from "./flags/tw.svg";
import us from "./flags/us.svg";
import za from "./flags/za.svg";

const FLAGS: Record<string, string> = {
  ae, ar, at, au, bh, br, ca, ch, cl, co, cz, de, dk, es, fi, fr, gb, hk, ie, il,
  in: inFlag, it, jp, ke, kr, mx, nl, no, nz, pl, pt, se, sg, tw, us, za
};

export function flagUrl(countryCode: string | undefined): string | undefined {
  return countryCode ? FLAGS[countryCode.toLowerCase()] : undefined;
}
