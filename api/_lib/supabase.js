/**
 * Supabase 클라이언트 (서버사이드 — Vercel Serverless Functions)
 * 읽기 전용: SUPABASE_ANON_KEY 사용
 */
import { createClient } from "@supabase/supabase-js";

let _client = null;

export function getSupabase() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL, SUPABASE_ANON_KEY 환경변수 필요");
  }

  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return _client;
}
