export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { workerService } = await import("@/lib/storage");
  await workerService.restore();
}
