import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import type { WorkerTask } from "@/lib/services/worker-service";
import { workerService } from "@/lib/storage";

export async function GET() {
  try {
    await requireSession();
    await workerService.restore();
    return NextResponse.json(await workerService.status());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json();
    const action = String(body.action || "");
    let result;
    if (action === "start") result = await workerService.start();
    else if (action === "stop") result = await workerService.stop();
    else if (action === "restart") result = await workerService.restart();
    else if (action === "run") result = await workerService.runNow(String(body.task || "all") as WorkerTask | "all");
    else if (action === "intervals") result = await workerService.updateIntervals(body.intervals || {});
    else throw new Error("Неизвестное действие worker");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
