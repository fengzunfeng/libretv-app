import { NextResponse } from 'next/server';

/** API Route 共享守卫：已取消所有访问限制，直接放行 */
export function guardRequest(req: Request): NextResponse | null {
  return null;
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
