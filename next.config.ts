import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@whiskeysockets/baileys", "pino", "qrcode"],
};

export default nextConfig;
