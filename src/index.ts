import "dotenv/config";

import { EventBus } from "./core/event-bus";
import { Principal } from "./core/principal";
import {
  AgentService,
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

async function main(): Promise<void> {
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

  const tools = new ToolService(busSvc, memorySvc, taskRepo, (from, msg) =>
    principalSvc.receive(from, msg),
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

  taskService.start();
  agentService.start();

  const directive =
    process.argv.slice(2).join(" ").trim() ||
    "Stand up the organization: define the first objectives, staff the departments you need, and report your plan back to me.";

  console.log(`[principal] ⇒ ${executive.id}\n${directive}\n`);
  principalSvc.send(directive);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
