/**
 * Supabase 클라이언트 (서버사이드 — Vercel Serverless Functions)
 * 읽기 전용: SUPABASE_ANON_KEY 사용
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
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

/**
 * Supabase 클라이언트 (서버사이드, mibunyang 스키마 전용)
 */
let _mibuyangClient: SupabaseClient | null = null;

export function getMibuyangSupabase(): SupabaseClient {
  if (_mibuyangClient) return _mibuyangClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수 필요");
  }
  _mibuyangClient = createClient(url, key, {
    db: { schema: 'public' },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _mibuyangClient;
}
