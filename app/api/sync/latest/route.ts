import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { fullSyncService } from "@/lib/storage";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({ report: await fullSyncService.latest() });
  } catch (error) {
    return apiError(error);
  }
}
