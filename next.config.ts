import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["proper-lockfile", "exceljs", "read-excel-file"],
};

export default nextConfig;
