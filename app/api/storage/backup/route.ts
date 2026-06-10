import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { storageDiagnosticsService } from "@/lib/storage";

export async function POST() {
  try {
    await requireSession();
    return NextResponse.json({ ok: true, ...(await storageDiagnosticsService.createBackup()) });
  } catch (error) {
    return apiError(error);
  }
}
