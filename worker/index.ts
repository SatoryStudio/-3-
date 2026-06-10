import { workerService } from "@/lib/storage";

await workerService.start();
console.log("Filament ERP worker запущен. Основной рекомендуемый режим — worker внутри Next.js.");
await new Promise(() => {});
