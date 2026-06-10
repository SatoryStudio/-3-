import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { fullSyncService } from "@/lib/storage";

export async function GET(request: Request) {
  try {
    await requireSession();
    const limit = Number(new URL(request.url).searchParams.get("limit") || 100);
    return NextResponse.json({ issues: await fullSyncService.issues(limit) });
  } catch (error) {
    return apiError(error);
  }
}
