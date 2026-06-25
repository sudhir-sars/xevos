import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compile the workspace TypeScript package (wire protocol + shared schema
  // types) directly from source.
  transpilePackages: ["@xevos/core"],
};

export default nextConfig;
