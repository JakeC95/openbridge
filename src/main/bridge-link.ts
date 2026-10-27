import net from "node:net";
import type { Logger } from "./logger";

export interface BridgeLinkOptions {
  getApiPort: () => number;
  getLibraryPath: () => string;
  logger: Logger;
  onRefresh: (assetId?: string) => void;
  onRemove: (assetId?: string) => void;
}

interface MixerMessage {
  message?: string;
  id?: string;
  assetId?: string;
  libraryPath?: string;
  version?: number;
}

const MIXER_OLD_RX = 28456;
const MIXER_OLD_TX = 28457;
const MIXER_NEW_RX = 28458;
const MIXER_NEW_TX = 28459;

export { MIXER_OLD_RX, MIXER_OLD_TX, MIXER_NEW_RX, MIXER_NEW_TX };

export class BridgeLink {
  private servers: net.Server[] = [];

  constructor(private readonly options: BridgeLinkOptions) {}

  async start(): Promise<void> {
    await this.stop();
    const settings = this.options;
    const discoveryPort = this.discoveryPort;

    this.listen(discoveryPort, socket => {
      const port = settings.getApiPort();
      settings.logger.info("Bridge Active Port request", { port });
      socket.end(String(port));
    }, "discovery");

    this.listenText(MIXER_OLD_RX, payload => {
      const libraryPath = payload.includes("_") ? payload.split("_").slice(1).join("_") : "";
      settings.logger.info("Mixer old message", { payload });
      if (!libraryPath || libraryPath === settings.getLibraryPath()) {
        settings.onRefresh();
      }
    }, "mixer-old");

    this.listenText(MIXER_NEW_RX, payload => {
      settings.logger.info("Mixer message", { payload });
      let messages: MixerMessage[];
      try {
        const parsed = JSON.parse(payload) as MixerMessage | MixerMessage[];
        messages = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return;
      }
      for (const message of messages) {
        if (message.libraryPath && message.libraryPath !== settings.getLibraryPath()) continue;
        if (message.message === "refresh") settings.onRefresh(message.id ?? message.assetId);
        if (message.message === "delete") settings.onRemove(message.id ?? message.assetId);
      }
    }, "mixer");
  }

  async stop(): Promise<void> {
    const servers = this.servers;
    this.servers = [];
    await Promise.all(
      servers.map(
        server =>
          new Promise<void>(resolve => {
            server.close(() => resolve());
          })
      )
    );
  }

  private discoveryPort = 28852;

  setDiscoveryPort(port: number): void {
    this.discoveryPort = port;
  }

  private listen(port: number, onSocket: (socket: net.Socket) => void, name: string): void {
    const server = net.createServer(onSocket);
    server.on("error", error => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        this.options.logger.warn(
          `Bridge ${name} port ${port} is already in use; this feature is disabled`,
          { port, code }
        );
      } else {
        this.options.logger.error(`Bridge ${name} server error`, { port, error });
      }
    });
    server.listen(port, "127.0.0.1", () => {
      this.options.logger.info(`Bridge ${name} listening`, { port });
    });
    this.servers.push(server);
  }

  private listenText(port: number, onMessage: (payload: string) => void, name: string): void {
    this.listen(
      port,
      socket => {
        const chunks: Buffer[] = [];
        socket.on("data", chunk => chunks.push(Buffer.from(chunk)));
        socket.on("error", error => this.options.logger.warn(`Bridge ${name} socket error`, { error }));
        socket.on("close", () => {
          const payload = Buffer.concat(chunks).toString("utf8").trim();
          if (payload) onMessage(payload);
        });
      },
      name
    );
  }
}
