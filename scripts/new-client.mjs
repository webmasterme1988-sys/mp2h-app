#!/usr/bin/env node
// Spins up a brand new client instance of this booking system: a new
// Supabase project (schema applied, storage buckets, auth configured) and
// a new Vercel project (deployed from this same repo, env vars set), then
// invites the client's first admin by email — the exact same invite-by-
// email flow /api/admin/invite already uses for every admin after this one.
//
// Usage:
//   node scripts/new-client.mjs "Ace Pickleball Club" admin@aceclub.com
//
// Required environment variables (set in your own shell, never committed):
//   SUPABASE_ACCESS_TOKEN   Personal access token (supabase.com/dashboard/account/tokens)
//   SUPABASE_ORG_SLUG       Your organization slug/ID (shown as "Organization slug" in
//                           Org Settings — same value that appears in the dashboard URL)
//   VERCEL_ACCESS_TOKEN     Personal access token (vercel.com/account/tokens)
//   VERCEL_TEAM_ID          Optional — only if this should belong to a Vercel Team
//   GITHUB_REPO             "owner/repo" of this codebase, e.g. "yourname/mp2h-app"
//
// Optional:
//   SUPABASE_REGION         Defaults to ap-southeast-1 (Singapore)
//   SCHEMA_FILE             Defaults to ./schema.sql

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

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

function randomPassword(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
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

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createSupabaseProject(name, dbPass) {
  console.log(`\n[1/10] Creating Supabase project "${name}"...`);
  const project = await supabaseFetch('/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      name,
      organization_slug: requireEnv('SUPABASE_ORG_SLUG'),
      db_pass: dbPass,
      region: process.env.SUPABASE_REGION || 'ap-southeast-1',
    }),
  });
  console.log(`  -> ref: ${project.ref}`);
  return project;
}

async function waitForProjectReady(ref) {
  console.log('[2/10] Waiting for project to finish provisioning (this can take a minute or two)...');
  for (let i = 0; i < 60; i++) {
    const project = await supabaseFetch(`/v1/projects/${ref}`);
    if (project.status === 'ACTIVE_HEALTHY') {
      console.log('  -> ready');
      return;
    }
    if (['INIT_FAILED', 'REMOVED', 'RESTORE_FAILED', 'PAUSE_FAILED'].includes(project.status)) {
      throw new Error(`Project provisioning failed with status: ${project.status}`);
    }
    await sleep(5000);
  }
  throw new Error('Timed out waiting for project to become ready.');
}

async function getApiKeys(ref) {
  console.log('[3/10] Fetching API keys...');
  const keys = await supabaseFetch(`/v1/projects/${ref}/api-keys?reveal=true`);
  const publishable = keys.find((k) => k.type === 'publishable');
  const secret = keys.find((k) => k.type === 'secret');
  if (!publishable || !secret) {
    throw new Error(
      `Could not find publishable/secret keys — got types: ${keys.map((k) => k.type).join(', ')}`
    );
  }
  return { publishableKey: publishable.api_key, secretKey: secret.api_key };
}

async function applySchema(ref, schemaFile) {
  console.log(`[4/10] Applying schema from ${schemaFile}...`);
  const sql = await readFile(schemaFile, 'utf8');
  await supabaseFetch(`/v1/projects/${ref}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query: sql, read_only: false }),
  });
  console.log('  -> schema applied');
}

async function createStorageBuckets(projectUrl, secretKey) {
  console.log('[5/10] Creating storage buckets...');
  const supabase = createClient(projectUrl, secretKey);
  for (const bucket of ['branding', 'receipts']) {
    const { error } = await supabase.storage.createBucket(bucket, { public: true });
    if (error && !error.message?.includes('already exists')) {
      throw new Error(`Failed to create bucket "${bucket}": ${error.message}`);
    }
    console.log(`  -> ${bucket}`);
  }
}

async function createVercelProject(name, githubRepo) {
  console.log(`\n[6/10] Creating Vercel project "${name}"...`);
  const project = await vercelFetch('/v11/projects', {
    method: 'POST',
    body: JSON.stringify({
      name,
      gitRepository: { type: 'github', repo: githubRepo },
    }),
  });
  // Vercel assigns this as the default production domain for a fresh
  // project with no custom domain attached — the standard "{name}.vercel.app"
  // pattern, deterministic from the project name we just chose.
  const siteUrl = `https://${name}.vercel.app`;
  console.log(`  -> project id: ${project.id}, will be live at ${siteUrl}`);
  return { project, siteUrl };
}

async function setVercelEnvVars(projectId, vars) {
  console.log('[7/10] Setting environment variables...');
  const payload = Object.entries(vars).map(([key, value]) => ({
    key,
    value,
    type: 'encrypted',
    target: ['production', 'preview', 'development'],
  }));
  await vercelFetch(`/v10/projects/${projectId}/env`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  console.log('  -> env vars set');
}

async function triggerDeployment(projectName, githubRepo, branch) {
  console.log(`[8/10] Triggering first deployment (branch: ${branch})...`);
  const [org, repo] = githubRepo.split('/');
  const deployment = await vercelFetch('/v13/deployments', {
    method: 'POST',
    body: JSON.stringify({
      name: projectName,
      target: 'production',
      gitSource: { type: 'github', ref: branch, org, repo },
    }),
  });
  console.log(`  -> deployment started: https://${deployment.url}`);
  if (branch !== 'main') {
    console.log(
      `  -> NOTE: Vercel's API has no way to set a project's ongoing "Production Branch" —\n` +
        `     that's a dashboard-only setting. This deployment was forced to production via\n` +
        `     target:"production", but future pushes to "${branch}" won't auto-deploy as\n` +
        `     production until you manually set it: Project Settings -> Git -> Production Branch.`
    );
  }
  return deployment;
}

async function configureSupabaseAuth(ref, siteUrl) {
  console.log('[9/10] Configuring Supabase auth redirect allow-list...');
  await supabaseFetch(`/v1/projects/${ref}/config/auth`, {
    method: 'PATCH',
    body: JSON.stringify({
      site_url: siteUrl,
      uri_allow_list: `${siteUrl}/admin/set-password`,
    }),
  });
  console.log('  -> configured');
}

async function inviteFirstAdmin(projectUrl, secretKey, email, siteUrl) {
  console.log(`[10/10] Inviting first admin (${email})...`);
  const supabase = createClient(projectUrl, secretKey);
  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/admin/set-password`,
  });
  if (error) throw new Error(`Failed to invite admin: ${error.message}`);

  // The invite route only ever grants the default admin role — super_admin
  // is deliberately never self-service, matching how the very first admin
  // on every existing deployment has had to be set manually too.
  const { data: users } = await supabase.auth.admin.listUsers();
  const invited = users.users.find((u) => u.email === email);
  if (!invited) throw new Error('Invited user not found after invite — cannot set super_admin role.');
  const { error: roleError } = await supabase.auth.admin.updateUserById(invited.id, {
    app_metadata: { role: 'super_admin' },
  });
  if (roleError) throw new Error(`Failed to set super_admin role: ${roleError.message}`);
  console.log('  -> invited as super_admin');
}

async function main() {
  const [, , clientName, adminEmail, branch = 'main'] = process.argv;
  if (!clientName || !adminEmail) {
    console.error(
      'Usage: node scripts/new-client.mjs "Client Name" admin@example.com [branch]\n' +
        '  branch defaults to "main" — pass a different branch name for a client that\n' +
        '  needs modified code instead of the standard version.'
    );
    process.exit(1);
  }

  requireEnv('SUPABASE_ACCESS_TOKEN');
  requireEnv('SUPABASE_ORG_SLUG');
  requireEnv('VERCEL_ACCESS_TOKEN');
  const githubRepo = requireEnv('GITHUB_REPO');
  const schemaFile = process.env.SCHEMA_FILE || './schema.sql';

  const slug = slugify(clientName);
  const dbPass = randomPassword();

  try {
    const project = await createSupabaseProject(slug, dbPass);
    await waitForProjectReady(project.ref);
    const { publishableKey, secretKey } = await getApiKeys(project.ref);
    const projectUrl = `https://${project.ref}.supabase.co`;

    await applySchema(project.ref, schemaFile);
    await createStorageBuckets(projectUrl, secretKey);

    const { project: vercelProject, siteUrl } = await createVercelProject(slug, githubRepo);
    await setVercelEnvVars(vercelProject.id, {
      NEXT_PUBLIC_SUPABASE_URL: projectUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: publishableKey,
      SUPABASE_SERVICE_ROLE_KEY: secretKey,
      NEXT_PUBLIC_SITE_URL: siteUrl,
    });
    await triggerDeployment(slug, githubRepo, branch);
    await configureSupabaseAuth(project.ref, siteUrl);
    await inviteFirstAdmin(projectUrl, secretKey, adminEmail, siteUrl);

    console.log('\n=== Done ===');
    console.log(`Supabase project:  https://supabase.com/dashboard/project/${project.ref}`);
    console.log(`Site:              ${siteUrl}`);
    console.log(`Branch deployed:   ${branch}`);
    console.log(`Admin invite sent to: ${adminEmail} — they'll set their own password via the link.`);
    console.log('\nGmail App Password and Cron Secret still need to be entered manually in the new');
    console.log('admin dashboard — those are never included in the schema or backup files.');
    console.log('If using booking reminders, also re-run the pg_cron SQL for the new project/domain.');
  } catch (err) {
    console.error('\nFailed:', err.message);
    process.exit(1);
  }
}

main();
