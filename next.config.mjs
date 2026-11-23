/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["exceljs"],
  images: { unoptimized: true },
};
export default nextConfig;
