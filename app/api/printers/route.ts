import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { printerService } from "@/lib/storage";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({ printers: await printerService.list(), statuses: await printerService.statuses() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireSession();
    return NextResponse.json({ ok: true, printer: await printerService.save(await request.json()) });
  } catch (error) {
    return apiError(error);
  }
}
