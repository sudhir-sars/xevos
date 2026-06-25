import "dotenv/config";

import { EventBus } from "./core/event-bus";
import { Principal } from "./core/principal";
import {
  AgentService,
  AuditService,
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

  const busSvc = new EventBus();
  const memorySvc = new MemoryService(taskRepo, agentMemoryRepo, warehouseRepo);
  const promptSvc = new PromptService(promptRepo, agentRepo);
  const principalSvc = new Principal(busSvc, executive.id);

  const tools = new ToolService(
    busSvc,
    memorySvc,
    taskRepo,
    agentRepo,
    (from, msg) => principalSvc.receive(from, msg),
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
  const auditService = new AuditService(busSvc, taskRepo);

  taskService.start();
  agentService.start();
  auditService.start();

  // Broadcast every EventBus event to the Principal UI over WebSocket, and
  // serve the initial store snapshot. Additive: does not touch mailbox delivery.
  await startObserverServer({
    bus: busSvc,
    sources: {
      agents: agentRepo,
      tasks: taskRepo,
      prompts: promptRepo,
      memoryWarehouse: warehouseRepo,
    },
    port: observerPort(),
    onPrincipalMessage: (content) => principalSvc.send(content),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
