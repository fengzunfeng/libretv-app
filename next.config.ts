import type { NextConfig } from 'next';
import fs from 'node:fs';
import path from 'node:path';

/** 版本号以 package.json 为单一来源，构建时注入 process.env.APP_VERSION */
function readAppVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 独立版（Standalone）：静态导出，全部前端逻辑打进 APK。
 * - output: 'export'：所有页面预渲染为静态 HTML
 * - assetPrefix: './'：静态资源使用相对路径，便于在 file:// 或本地 WebView 中加载
 * - trailingSlash: true：链接统一带尾斜杠，本地加载更稳
 */
const nextConfig: NextConfig = {
  output: 'export',
  assetPrefix: './',
  trailingSlash: true,
  reactStrictMode: true,
  env: { APP_VERSION: readAppVersion() },
  images: { unoptimized: true },
};

export default nextConfig;
