/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/pma",
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },
};

export default nextConfig;
