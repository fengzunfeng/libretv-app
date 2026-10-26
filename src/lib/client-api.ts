'use client';

import type {
  AuthStatusResponse,
  BangumiCalendarResponse,
  DoubanResponse,
  LiveEpgResponse,
  LivePlaylistResponse,
  QualityProbeItem,
  QualityProbeResult,
  SearchResponse,
  SourceConfig,
  SourceListPayload,
  SourceSearchOutcome,
  VideoDetail,
} from './types';
import {
  cmsRequestHeaders,
  parseSearchList,
  parseDetail,
  parseDetailPageHtml,
  filterAdultResults,
  filterRelevantResults,
  normalizeTitle,
} from './cms-parser';

/**
 * LibreTV 独立版（Standalone）客户端 API。
 *
 * 纯前端实现：搜索 / 详情 / 测活全部在浏览器（WebView）内直连采集站完成，
 * 不依赖任何后端服务。安卓壳（ProxyWebViewClient）在 WebView 层拦截并代理
 * 所有 http/https 请求（含 libretv.local 虚拟代理），因此无需考虑 CORS 与防盗链。
 *
 * 辅助能力（直播、豆瓣推荐、画质探测、订阅发布）在独立版中降级为空实现，
 * 保持函数签名不变，调用方无需改动。
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const UNAUTHORIZED_EVENT = 'libretv:unauthorized';

/** 单条测活结果（兼容旧结构，独立版不使用） */
export interface LiveProbeResult {
  url: string;
  ok: boolean;
  status?: number;
  ms?: number;
  level?: 'segment' | 'manifest' | 'head';
  error?: string;
  codec?: string;
  timedOut?: boolean;
  kbps?: number;
}

/** /api/status 的 React Query key（保留，供 Providers/AuthProvider 共用） */
export const STATUS_QUERY_KEY = ['app-status'] as const;

export function onUnauthorized(handler: (event: CustomEvent) => void): () => void {
  const wrapped = (e: Event) => handler(e as CustomEvent);
  window.addEventListener(UNAUTHORIZED_EVENT, wrapped);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, wrapped);
}

// —— 独立版固定状态：无需密码、已验证；内置一批公开采集站源（可失效，用户可在设置中增删） ——

// 内置源为“搜索+详情+播放”全链路实测可用的采集站（2026-10-26 复测）：
// 量子(lziapi)手机端 TLS 兼容失败、人人影视播放需鉴权(401)、无尽不稳定——均不内置，可手动添加尝试
const BUILTIN_SOURCES: SourceConfig[] = [
  { key: 'ffm3u8', name: '非凡资源', url: 'https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8' },
  { key: 'gsm3u8', name: '光速资源', url: 'https://api.guangsuapi.com/api.php/provide/vod' },
  { key: '360zy', name: '360资源', url: 'https://360zy.com/api.php/provide/vod' },
  { key: 'dbm3u8', name: '百度资源', url: 'https://api.apibdzy.com/api.php/provide/vod/from/dbm3u8' },
];

/** 请求超时信号：优先 AbortSignal.timeout；老 WebView 降级为手动 AbortController */
function withTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}


const STANDALONE_STATUS: AuthStatusResponse = {
  passwordRequired: false,
  verified: true,
  version: 'standalone-2.19.7',
  defaultSources: BUILTIN_SOURCES,
  defaultLiveSources: [],
  defaultSubscriptions: [],
  defaultRecommendSource: null,
  defaultImageMode: null,
};

// —— 搜索（浏览器端直连，多源并行第一页 + 聚合） ——

async function searchSourceDirect(
  source: SourceConfig,
  wd: string,
  signal?: AbortSignal
): Promise<SourceSearchOutcome> {
  const start = Date.now();
  const finish = (outcome: Omit<SourceSearchOutcome, 'ms'>): SourceSearchOutcome => ({
    ...outcome,
    ms: Date.now() - start,
  });
  try {
    if (!/^https?:\/\//.test(source.url || '')) {
      return finish({ sourceKey: source.key, ok: false, list: [], error: '无效的源地址' });
    }
    const api = `${source.url.replace(/\/+$/, '')}?ac=videolist&wd=${encodeURIComponent(wd)}&pg=1`;
    const res = await fetch(api, { headers: cmsRequestHeaders(), signal: withTimeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list = parseSearchList(data, source);
    return finish({ sourceKey: source.key, ok: true, list });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return finish({
      sourceKey: source.key,
      ok: false,
      list: [],
      error: aborted ? '已取消' : err instanceof Error ? err.message : '请求失败',
      timedOut: !aborted && err instanceof Error && err.name === 'TimeoutError',
    });
  }
}

/** 合并 + 去重 + 过滤 + 排序（与旧版服务端聚合逻辑对齐） */
function aggregateOutcomes(
  outcomes: SourceSearchOutcome[],
  wd: string,
  filterAdult: boolean
): SearchResponse {
  const seen = new Set<string>();
  let list = outcomes.flatMap((o) => o.list).filter((item) => {
    const key = `${item.sourceKey}_${item.vodId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  list = filterAdultResults(list, filterAdult);
  list = filterRelevantResults(list, wd);

  const exact = normalizeTitle(wd);
  list.sort((a, b) => {
    const aExact = normalizeTitle(a.name || '') === exact ? 0 : 1;
    const bExact = normalizeTitle(b.name || '') === exact ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const nameCompare = (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN');
    if (nameCompare !== 0) return nameCompare;
    return (a.sourceName || '').localeCompare(b.sourceName || '', 'zh-Hans-CN');
  });

  const failures = outcomes
    .filter((o) => !o.ok)
    .map((o) => ({ sourceKey: o.sourceKey, error: o.error || '请求失败', timedOut: o.timedOut }));

  return { list, failures };
}

// —— 详情（浏览器端直连：列表接口 + 详情页 HTML 降级） ——

async function fetchDetailDirect(id: string, source: SourceConfig, signal?: AbortSignal): Promise<VideoDetail> {
  if (!/^https?:\/\//.test(source.url || '')) {
    throw new Error('无效的点播源配置');
  }
  const base = source.url.replace(/\/+$/, '');
  let resolved: VideoDetail | null = null;

  // 1) 标准列表接口
  const api = `${base}?ac=videolist&ids=${encodeURIComponent(id)}`;
  try {
    const res = await fetch(api, { headers: cmsRequestHeaders(), signal: withTimeout(8000) });
    if (res.ok) {
      const data = await res.json();
      try {
        const detail = parseDetail(data, source);
        if (detail.episodes.length > 0) resolved = detail;
      } catch {
        // 无内容，继续尝试详情页
      }
    }
  } catch {
    // 网络失败，继续尝试详情页
  }

  // 2) 详情页 HTML 提取（部分源需要爬详情页）
  if (!resolved) {
    let detailRoot: string;
    try {
      detailRoot = (source.detail || new URL(source.url).origin).replace(/\/+$/, '');
    } catch {
      detailRoot = '';
    }
    if (/^https?:\/\//.test(detailRoot)) {
      try {
        const detailUrl = `${detailRoot}/index.php/vod/detail/id/${id}.html`;
        const detailRes = await fetch(detailUrl, {
          headers: { 'User-Agent': cmsRequestHeaders()['User-Agent'], Accept: 'text/html' },
          signal: withTimeout(8000),
        });
        if (detailRes.ok) {
          const html = await detailRes.text();
          resolved = parseDetailPageHtml(html, source);
        }
      } catch {
        // 详情页提取失败，交给下方统一报错
      }
    }
  }

  if (!resolved || resolved.episodes.length === 0) {
    throw new Error('未找到播放资源');
  }
  return resolved;
}

export const api = {
  status: async (): Promise<AuthStatusResponse> => STANDALONE_STATUS,

  login: async (_password?: string): Promise<{ success: boolean }> => ({ success: true }),

  logout: async (): Promise<{ success: boolean }> => ({ success: true }),

  /**
   * 聚合搜索（浏览器端直连）。传入 onSource 时逐源回调，最终以聚合结果 resolve。
   */
  search: async (
    wd: string,
    sources: SourceConfig[],
    filterAdult: boolean,
    opts?: { signal?: AbortSignal; onSource?: (outcome: SourceSearchOutcome) => void }
  ): Promise<SearchResponse> => {
    const signal = opts?.signal;
    const onSource = opts?.onSource;
    const outcomes = await Promise.all(
      sources.slice(0, 50).map((source) => searchSourceDirect(source, wd, signal))
    );
    if (onSource) {
      for (const outcome of outcomes) onSource(outcome);
    }
    return aggregateOutcomes(outcomes, wd, filterAdult);
  },

  detail: (id: string, source: SourceConfig, signal?: AbortSignal) => fetchDetailDirect(id, source, signal),

  /** 换源：按标题跨源搜索并取详情，附带接口耗时（测速） */
  detailSpeed: async (id: string, source: SourceConfig, signal?: AbortSignal) => {
    const start = performance.now();
    try {
      const detail = await api.detail(id, source, signal);
      return { ok: true, ms: Math.round(performance.now() - start), detail };
    } catch (err) {
      return {
        ok: false,
        ms: Math.round(performance.now() - start),
        detail: undefined as VideoDetail | undefined,
        error: err instanceof Error ? err.message : '失败',
      };
    }
  },

  // —— 以下辅助能力在独立版中降级为空实现 ——

  douban: async (
    _type?: string,
    _tag?: string,
    _pageStart?: number,
    _pageSize?: number,
    _signal?: AbortSignal
  ): Promise<DoubanResponse> => ({ items: [] }),

  bangumiCalendar: async (_signal?: AbortSignal): Promise<BangumiCalendarResponse> => ({ days: [] }),

  hotList: async (_id?: string, _signal?: AbortSignal): Promise<DoubanResponse> => ({ items: [] }),

  qualityProbeStream: async (
    _items: QualityProbeItem[],
    _onResult: (result: QualityProbeResult) => void,
    _signal?: AbortSignal
  ): Promise<void> => {
    // 独立版不做画质探测
  },

  /** 源测活：直连采集站搜索 "test" 衡量可用性 */
  testSource: async (url: string) => {
    const start = performance.now();
    try {
      const base = url.replace(/\/+$/, '');
      const res = await fetch(`${base}?ac=videolist&wd=test&pg=1`, { headers: cmsRequestHeaders(), signal: withTimeout(8000) });
      const ms = Math.round(performance.now() - start);
      if (!res.ok) {
        // 附带响应体摘要：代理 502 时能看到真实错误（如 SSLHandshakeException / ConnectException）
        let detail = "";
        try { detail = (await res.text()).slice(0, 120); } catch { /* 忽略 */ }
        return { ok: false, ms, error: detail ? `HTTP ${res.status} ${detail}` : `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { list?: unknown };
      const count = Array.isArray(data.list) ? data.list.length : 0;
      return { ok: true, ms, count };
    } catch (err) {
      return {
        ok: false,
        ms: Math.round(performance.now() - start),
        error: err instanceof Error ? err.message : '请求失败',
      };
    }
  },

  /** 远程订阅：直连拉取并解析（支持 LibreTV-SourceList JSON；失败时抛错） */
  fetchSourceList: async (url: string): Promise<SourceListPayload> => {
    const res = await fetch(url, { headers: cmsRequestHeaders(), signal: withTimeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new Error('订阅内容不是有效的 JSON');
    }
    const obj = data as { name?: string; sources?: unknown; lives?: unknown };
    const sources = Array.isArray(obj.sources)
      ? (obj.sources as { name?: string; url?: string }[])
          .filter((s) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url))
          .map((s) => {
            const url = s.url as string;
            return { name: s.name || url, url };
          })
      : [];
    const liveSources = Array.isArray(obj.lives)
      ? (obj.lives as { name?: string; url?: string; epg?: string }[])
          .filter((l) => l && typeof l.url === 'string' && /^https?:\/\//.test(l.url))
          .map((l) => {
            const url = l.url as string;
            return { name: l.name || url, url, epg: l.epg };
          })
      : [];
    if (sources.length === 0 && liveSources.length === 0) {
      throw new Error('订阅内容为空或格式不支持');
    }
    return { name: obj.name, sources, liveSources };
  },

  /** 独立版不支持发布订阅到第三方粘贴板 */
  publishSourceList: async (
    _payload?: { name?: string; sources: { name: string; url: string }[]; liveSources: { name: string; url: string; epg?: string }[] }
  ): Promise<{ url: string; provider: string; sources: number; liveSources: number }> => {
    throw new ApiError('独立版不支持发布订阅', 501);
  },

  // —— 直播 / IPTV：独立版降级为空（保留原签名，忽略参数） ——

  livePlaylist: async (_url?: string, _force?: boolean, _signal?: AbortSignal): Promise<LivePlaylistResponse> => ({
    channels: [],
    groups: [],
  }),

  liveEpg: async (_epgUrl?: string, _tvgId?: string, _force?: boolean, _signal?: AbortSignal): Promise<LiveEpgResponse> => ({
    channelId: '',
    programs: [],
  }),

  liveTest: async (_url?: string) => ({ ok: false, ms: 0, count: 0, error: '独立版不支持直播' }),

  liveExportUrl: (_url?: string) => '',

  liveProbe: async (): Promise<{ results: LiveProbeResult[] }> => ({ results: [] }),

  liveProbeStream: async (
    _urls: string[],
    _onResult: (result: LiveProbeResult) => void,
    _signal?: AbortSignal
  ): Promise<void> => {
    // 独立版不做直播测活
  },
};

export interface SearchFailure {
  sourceKey: string;
  error: string;
  timedOut?: boolean;
}

export type { SearchResponse, SearchResultItem } from './types';
