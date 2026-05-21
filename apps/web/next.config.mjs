/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  allowedDevOrigins: ["192.168.93.125"],
  async rewrites() {
    const apiUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
    return [
      {
        source: "/api-proxy/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
