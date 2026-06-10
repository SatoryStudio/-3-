import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { problemOrderService } from "@/lib/storage";

export async function POST() {
  try {
    await requireSession();
    const report = await problemOrderService.retryAll();
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return apiError(error);
  }
}
