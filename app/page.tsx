import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { storage } from "@/lib/storage";
import { ErpApp } from "@/components/erp-app";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const database = await storage.read();
  if (!database.users.length) redirect("/setup");
  const session = await getSession();
  if (!session) redirect("/login");
  return <ErpApp email={session.email} />;
}
