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
 * - 不使用 assetPrefix：RSC payload 与 HTML 内的资源引用都使用标准绝对路径
 *   /_next/static/...，安卓壳 serveLocal 已对站点绝对路径做完整映射
 *   （file:///_next/... → assets/www/_next/...）。
 *   注意：assetPrefix: './' 会导致 RSC payload 的 chunk 引用变成 static/chunks/...
 *   （丢失 _next/ 前缀），SPA 导航时动态 import 404、路由失败（页面显示 RSC 原文）。
 * - trailingSlash: true：链接统一带尾斜杠，本地加载更稳
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  env: { APP_VERSION: readAppVersion() },
  images: { unoptimized: true },
};

export default nextConfig;
