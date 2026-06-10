import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { googleSheetsService } from "@/lib/storage";

export async function DELETE() {
  try {
    await requireSession();
    await googleSheetsService.disconnect();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
