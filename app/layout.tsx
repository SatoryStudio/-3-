import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Filament ERP",
  description: "Учёт заказов, печати, филамента и прибыли",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
