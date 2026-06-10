import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { fullSyncService } from "@/lib/storage";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json(fullSyncService.status());
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    const body = await request.json().catch(() => ({}));
    const days = Math.min(1095, Math.max(1, Number(body.period || 30)));
    const to = body.to ? new Date(body.to) : new Date();
    const from = body.from ? new Date(body.from) : new Date(to.getTime() - days * 86_400_000);
    const report = await fullSyncService.run({ from: from.toISOString(), to: to.toISOString() });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return apiError(error);
  }
}
