const env = import.meta.env;
export const API_URL = (env.VITE_API_URL || '').replace(/\/$/, '');
export const SUPABASE_URL = env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';
export const CLOUD_AVAILABLE = Boolean(API_URL && SUPABASE_URL && SUPABASE_ANON_KEY);
