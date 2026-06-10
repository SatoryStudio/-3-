import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { googleSheetsService } from "@/lib/storage";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json(await googleSheetsService.status());
  } catch (error) {
    return apiError(error);
  }
}
