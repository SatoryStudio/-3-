import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { apiError } from "@/lib/http";
import { printerService } from "@/lib/storage";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    return NextResponse.json(await printerService.test((await context.params).id));
  } catch (error) {
    return apiError(error);
  }
}
