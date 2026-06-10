import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { storageDiagnosticsService } from "@/lib/storage";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json(await storageDiagnosticsService.diagnose());
  } catch (error) {
    return apiError(error);
  }
}
