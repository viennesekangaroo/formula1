import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],

  async headers() {
    return [
      {
        // Pre-compressed race replay files. The browser decompresses
        // natively when Content-Encoding is set, so we don't ship a JS
        // brotli decoder. Race data is immutable — cache forever on the
        // CDN, and a long browser cache is fine since we publish-and-go
        // (a new commit changes the URL anyway because Vercel busts).
        source: "/api/race/:round.json.br",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Content-Encoding", value: "br" },
          {
            key: "Cache-Control",
            value: "public, max-age=86400, s-maxage=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
