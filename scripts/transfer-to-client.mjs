#!/usr/bin/env node
// Hands off an already-created client instance (built via new-client.mjs)
// to that client's own Supabase/Vercel accounts. Only automates YOUR side
// of the handshake — generating a claim token / transfer code — since
// accepting it requires the client's own account and can't be done on
// their behalf. The client needs to have already signed up for a free
// Supabase account and a free Vercel account before running this.
//
// Usage:
//   node scripts/transfer-to-client.mjs <supabase-project-ref> <vercel-project-id-or-name>
//
// Required environment variables (same ones new-client.mjs uses):
//   SUPABASE_ACCESS_TOKEN
//   VERCEL_ACCESS_TOKEN
//   VERCEL_TEAM_ID   Optional — only if the project currently belongs to a Team

const SUPABASE_API = 'https://api.supabase.com';
const VERCEL_API = 'https://api.vercel.com';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Supabase API ${path} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function vercelFetch(path, options = {}) {
  const url = new URL(`${VERCEL_API}${path}`);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set('teamId', process.env.VERCEL_TEAM_ID);

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Vercel API ${path} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function createSupabaseClaimToken(ref) {
  console.log(`[1/2] Generating Supabase claim token for project ${ref}...`);
  const result = await supabaseFetch(`/v1/projects/${ref}/claim-token`, { method: 'POST' });
  console.log(`  -> token: ${result.token}`);
  console.log(`  -> expires: ${result.expires_at}`);
  return result;
}

async function createVercelTransferRequest(idOrName) {
  console.log(`[2/2] Generating Vercel transfer request for project ${idOrName}...`);
  const result = await vercelFetch(`/projects/${idOrName}/transfer-request`, { method: 'POST' });
  console.log(`  -> code: ${result.code}`);
  return result;
}

async function main() {
  const [, , supabaseRef, vercelProject] = process.argv;
  if (!supabaseRef || !vercelProject) {
    console.error(
      'Usage: node scripts/transfer-to-client.mjs <supabase-project-ref> <vercel-project-id-or-name>'
    );
    process.exit(1);
  }

  requireEnv('SUPABASE_ACCESS_TOKEN');
  requireEnv('VERCEL_ACCESS_TOKEN');

  try {
    const claim = await createSupabaseClaimToken(supabaseRef);
    const transfer = await createVercelTransferRequest(vercelProject);

    console.log('\n=== Send the client these two things ===\n');

    console.log('VERCEL (confirmed working link — the client just needs to click it while');
    console.log('logged into their own Vercel account, no API calls needed on their end):');
    console.log(`  https://vercel.com/claim-deployment?code=${transfer.code}\n`);
    console.log('  This code expires in 24 hours.\n');

    console.log('SUPABASE (raw token only — I could not verify an exact clickable claim URL');
    console.log('from the docs, so test this once yourself before relying on it for a real');
    console.log('handoff. The client needs to be logged into their own Supabase account, then');
    console.log('either use this token through the dashboard\'s claim/transfer flow, or you can');
    console.log('walk them through it live the first time to confirm the exact steps):');
    console.log(`  Project ref:   ${supabaseRef}`);
    console.log(`  Claim token:   ${claim.token}`);
    console.log(`  Token alias:   ${claim.token_alias}`);
    console.log(`  Expires:       ${claim.expires_at}`);

    console.log('\nAfter both are accepted, you will lose direct dashboard/API access to this');
    console.log('project and deployment unless the client adds you back as a collaborator.');
  } catch (err) {
    console.error('\nFailed:', err.message);
    process.exit(1);
  }
}

main();
