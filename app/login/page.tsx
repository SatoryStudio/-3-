import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { storage } from "@/lib/storage";
import { AuthForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const database = await storage.read();
  if (!database.users.length) redirect("/setup");
  if (await getSession()) redirect("/");
  return <AuthForm mode="login" />;
}
