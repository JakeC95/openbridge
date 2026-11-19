import { createRoot } from "react-dom/client";
import { ModelViewer } from "../components/ModelViewer";
import type { ModelManifest } from "../../shared/model-preview";

declare global {
  interface Window {
    modelThumbnail: { manifest(): Promise<ModelManifest>; ready(): void; error(message: string): void };
  }
}
const ready = () => window.modelThumbnail.ready();
const error = (message: string) => window.modelThumbnail.error(message);
window.addEventListener("error", event => error(event.message));
window.addEventListener("unhandledrejection", event => error(String(event.reason)));
void window.modelThumbnail.manifest().then(manifest => {
  createRoot(document.getElementById("root")!).render(
    <ModelViewer manifest={manifest} quality={1024} lod="highest" thumbnailMode onReady={ready} onError={error} />
  );
}).catch(error);
