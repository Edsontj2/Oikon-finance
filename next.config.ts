import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  experimental: {
    // Nenhum formulário do app passa de poucos KB; o padrão do Next é 1 MB.
    serverActions: { bodySizeLimit: "64kb" },
  },
};

export default nextConfig;
