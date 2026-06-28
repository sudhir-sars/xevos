import type { PlatformConnector } from "@xevos/platforms";

/**
 * Holds the live platform connectors (Twitter, …) so the static platform tools
 * can find one at call time and run its action. Populated at startup; a tool
 * for an unconfigured platform returns a clean "not connected" error rather than
 * failing. Standalone (only depends on the platforms package) so the tool layer
 * can import it without a cycle.
 */
export class ConnectorRegistry {
  private readonly byId = new Map<string, PlatformConnector>();

  register(connector: PlatformConnector): void {
    this.byId.set(connector.id, connector);
  }

  get(id: string): PlatformConnector | undefined {
    return this.byId.get(id);
  }

  list(): PlatformConnector[] {
    return [...this.byId.values()];
  }
}
