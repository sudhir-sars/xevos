import "dotenv/config";

import {
  BrowserSession,
  FileSessionStore,
  TwitterConnector,
} from "@xevos/platforms";

import { DrizzleEventStore, EventBus } from "./core/event-bus";
import { Principal } from "./core/principal";
import {
  AgentService,
  AuditService,
  ConnectorRegistry,
  ConnectorService,
  MemoryService,
  PromptService,
  TaskService,
  ToolService,
} from "./core/services";
import {
  AgentMemoryRepository,
  AgentRepository,
  MemoryWarehouseRepository,
  TaskRepository,
} from "./repositories";
import { PromptRepository } from "./repositories/prompt";
import { startObserverServer } from "./observer/ws-server";

function observerPort(): number {
  const raw = process.env.XEVOS_OBSERVER_PORT;
  const parsed = raw ? Number(raw) : NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 7077;
}

async function main(): Promise<void> {
  console.log({
    cwd: process.cwd(),
    gemini: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  const [agentRepo, taskRepo, promptRepo, agentMemoryRepo, warehouseRepo] =
    await Promise.all([
      AgentRepository.create(),
      TaskRepository.create(),
      PromptRepository.create(),
      AgentMemoryRepository.create(),
      MemoryWarehouseRepository.create(),
    ]);

  const executive = agentRepo.getCEO();

  // Durable bus: every event hits the audit log, every targeted event the
  // inbox queue, so in-flight work survives a restart.
  const busSvc = new EventBus(new DrizzleEventStore());
  const memorySvc = new MemoryService(taskRepo, agentMemoryRepo, warehouseRepo);
  const promptSvc = new PromptService(promptRepo, agentRepo);
  const principalSvc = new Principal(busSvc, executive.id);

  const connectors = new ConnectorRegistry();
  const tools = new ToolService(
    busSvc,
    memorySvc,
    taskRepo,
    agentRepo,
    (from, msg) => principalSvc.receive(from, msg),
    connectors,
  );

  const taskService = new TaskService(busSvc, taskRepo, agentRepo, memorySvc);
  const agentService = new AgentService(
    agentRepo,
    taskRepo,
    busSvc,
    memorySvc,
    tools,
    promptSvc,
  );
  const auditService = new AuditService(
    busSvc,
    taskRepo,
    agentRepo,
    agentMemoryRepo,
  );

  // Two-phase wiring: the trivial tools call these org operations DIRECTLY
  // (in-process, no bus round-trip) instead of publishing a request and parking
  // on wait_until_response. The backing services depend on `tools`, so the link
  // is set after they exist.
  tools.setOrgOps({
    createAgent: (creatorId, spec) => agentService.create(creatorId, spec),
    createTask: (source, spec) => taskService.create(source, spec),
    transitionTask: (source, id, to, note) =>
      taskService.transition(source, id, to, note),
  });

  taskService.start();
  agentService.start();
  auditService.start();

  // Subscribers are live; replay any work left unprocessed by a previous crash.
  busSvc.recover();

  // Platform connectors (Obscura-backed Twitter/etc.): register them so the
  // platform action tools can reach them, and poll for activity to push onto
  // the bus as synthetic-webhook events. Off unless an account is configured;
  // needs a running Obscura engine + a captured session.
  startConnectors(busSvc, connectors);

  // Broadcast every EventBus event to the Principal UI over WebSocket, and
  // serve the initial store snapshot. Additive: does not touch mailbox delivery.
  await startObserverServer({
    bus: busSvc,
    sources: {
      agents: agentRepo,
      prompts: promptRepo,
    },
    port: observerPort(),
    onPrincipalMessage: (content) => principalSvc.send(content),
  });
}

/**
 * Start platform connectors if configured. Gated on XEVOS_TWITTER_ACCOUNT so the
 * org runs fine without any platform automation; when set, it needs a running
 * Obscura engine (OBSCURA_CDP_URL) and a captured session for the account.
 */
function startConnectors(bus: EventBus, registry: ConnectorRegistry): void {
  const account = process.env.XEVOS_TWITTER_ACCOUNT;
  if (!account) return;

  const twitter = new TwitterConnector(
    new BrowserSession({ account, store: new FileSessionStore() }),
  );
  registry.register(twitter); // so the platform tools can reach it

  new ConnectorService({ bus, connectors: registry.list() }).start();
  console.log(`[connectors] started — twitter:${account}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
