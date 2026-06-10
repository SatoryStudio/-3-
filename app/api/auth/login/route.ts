import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth/session";
import { apiError } from "@/lib/http";
import { storage } from "@/lib/storage";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    const database = await storage.read();
    const user = database.users.find((item) => item.email === String(email).trim().toLowerCase());
    if (!user || !(await bcrypt.compare(String(password), user.password_hash))) throw new Error("Неверный email или пароль");
    await storage.transaction((unit) => {
      const current = unit.data.users.find((item) => item.id === user.id)!;
      current.last_login = new Date().toISOString();
      unit.touch("users");
    });
    await createSession(user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
