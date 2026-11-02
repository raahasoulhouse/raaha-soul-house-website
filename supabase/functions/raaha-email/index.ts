// RAAHA email service entry point (Supabase Edge Function). Logic lives in raaha-email.ts.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import * as PDFLib from 'npm:pdf-lib@1.17.1';
import { route, SITE } from './raaha-email.ts';

const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
});
let logo: Uint8Array | null = null;
async function getLogo() {
  if (logo) return logo;
  const r = await fetch(SITE + '/assets/images/brand/raaha-logo-burgundy.png');
  if (!r.ok) throw new Error('logo ' + r.status);
  logo = new Uint8Array(await r.arrayBuffer());
  return logo;
}

Deno.serve((req: Request) => route(req, {
  svc, fetch, PDFLib, getLogo,
  env: { RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'), RESEND_WEBHOOK_SECRET: Deno.env.get('RESEND_WEBHOOK_SECRET') }
}));
