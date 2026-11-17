/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  allowedDevOrigins: ["192.168.93.125"],
  // Resolve explicit `.js` specifiers to their `.ts(x)` source. The shared
  // `@pma/types` barrel re-exports `./simat.js` (the extension Node ESM needs
  // for the API build); without this, `next build` (webpack) cannot find it.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  async rewrites() {
    const apiUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
    const rules = [
      {
        source: "/api-proxy/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
    // Development only: RustGIS (infra/rustgis) for the Workspace. In production
    // nginx serves it at /geo/workspace/app/ and the request never reaches Next.
    if (process.env.RUSTGIS_DEV_URL) {
      rules.push({
        source: "/geo/workspace/app/:path*",
        destination: `${process.env.RUSTGIS_DEV_URL.replace(/\/+$/, "")}/:path*`,
      });
    }
    return rules;
  },
};

export default nextConfig;
