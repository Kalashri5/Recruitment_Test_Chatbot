import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseServiceKey = process.env.REACT_APP_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing REACT_APP_SUPABASE_URL environment variable');
}

if (!supabaseServiceKey) {
  throw new Error('Missing REACT_APP_SUPABASE_SERVICE_ROLE_KEY environment variable');
}

// Special client for chatbot with service role key (bypasses RLS)
export const supabaseChatbot = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
  },
});