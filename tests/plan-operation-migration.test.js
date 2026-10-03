import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static contract over migration C, its rollback and its VERIFY script.
// Text assertions only: nothing here touches a database.

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
const read = (name) => readFileSync(new URL(name, MIGRATIONS), 'utf8');

const A = read('20260928140000_profile_safety_fingerprint.sql');
const LATCH = read('20260918060000_protect_onboarding_completed_latch.sql');
const FORWARD = read('20261002120000_plan_operation_cooldown.sql');
const ROLLBACK = read('20261002120001_drop_plan_operation_cooldown.sql');
const VERIFY = read('VERIFY_plan_operation_cooldown.sql');
const VERIFY_A = read('VERIFY_profile_safety_fingerprint.sql');

// Production md5(prosrc), measured 2026-10-02.
const A_BODY_MD5 = 'a88fc6c9fa02ab37fd2390ccacde264a';
const LATCH_MD5 = '2ba28d83975dd1d061e8c4ca7d35b1f4';
const BILLING_MD5 = '267a03753824a7c0c5e39be1bf6785e2';
const FINGERPRINT_TRIGGER_MD5 = '038f21e089322300f22e5aa840f676d9';
const C_BODY_MD5 = '8a558cb77f1e686e1018f0f66dabd1ea';

const SIG10 = 'uuid, uuid, text, text, date, integer, date, jsonb, jsonb, text';
const SIG11 = `${SIG10}, text`;
const OPERATIONS = ['initial_setup', 'feedback_adjustment', 'safety_regeneration'];
const ANCHORS = ['first_plan_at', 'last_plan_adjustment_at'];

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

// The one $tag$ ... $tag$ block with this tag in the file: exactly the text
// Postgres stores as prosrc when that literal is passed to CREATE FUNCTION,
// including the newline after the opening tag and before the closing one.
function dollarBlock(sql, tag) {
  const marker = `$${tag}$`;
  const start = sql.indexOf(marker);
  const end = sql.indexOf(marker, start + marker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  expect(sql.indexOf(marker, end + marker.length)).toBe(-1);
  return sql.slice(start + marker.length, end);
}

const rpcBody = (sql) => dollarBlock(sql, 'fnbody');

function withoutRpcBody(sql) {
  const start = sql.indexOf('$fnbody$');
  const end = sql.indexOf('$fnbody$', start + 8);
  return sql.slice(0, start) + sql.slice(end + 8);
}

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

const squash = (text) => text.replace(/\s+/g, ' ').trim();

// Concatenated '...' || '...' literals after `from` and before `to`, joined.
function joinedLiterals(sql, from, to) {
  const start = sql.indexOf(from);
  const end = sql.indexOf(to, start + from.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...sql.slice(start + from.length, end).matchAll(/'([^']*)'/g)].map((m) => m[1]).join('');
}

function statementsMentioning(sql, word) {
  return stripComments(sql)
    .split(';')
    .filter((s) => new RegExp(`\\b${word}\\b`).test(s));
}

const CREATE_FROM = "'CREATE FUNCTION public.replace_user_plans_atomic('";
const CREATE_ARGS_TO = "|| 'RETURNS TABLE";

describe('reproducing the production md5 values from the committed files', () => {
  it("migration A's RPC body is the $fnbody$ literal, newlines included", () => {
    const body = rpcBody(A);
    expect(body.startsWith('\nDECLARE\n')).toBe(true);
    expect(body.endsWith('\nEND;\n')).toBe(true);
    expect(md5(body)).toBe(A_BODY_MD5);
    // Dropping the leading newline gives the wrong value measured earlier.
    expect(md5(body.slice(1))).not.toBe(A_BODY_MD5);
  });

  it("migration A's set_profile_safety_fingerprint body reproduces", () => {
    expect(md5(dollarBlock(A, 'trgbody'))).toBe(FINGERPRINT_TRIGGER_MD5);
  });

  it('the latch body reproduces once its one ASCII arrow is the production Unicode arrow', () => {
    const repo = dollarBlock(LATCH, 'function');
    const line = '  -- Service role and dashboard admin have no auth.uid() -> allow';
    expect(repo.split('->')).toHaveLength(2);
    expect(repo).toContain(line);
    expect(md5(repo)).not.toBe(LATCH_MD5);
    expect(md5(repo.replace(line, line.replace('->', '→')))).toBe(LATCH_MD5);
  });
});

describe('forward migration 20261002120000: preconditions', () => {
  it("guards on migration A's body md5 for the fresh state", () => {
    expect(FORWARD).toContain(`('a_body_md5',       '${A_BODY_MD5}')`);
    expect(FORWARD).toContain('rpc_is_a   := is_ten AND md5(fn.prosrc) = c_a_md5;');
    expect(FORWARD).toContain('rpc_is_new := NOT is_ten AND fn.prosrc = c_rpc_body;');
    expect(FORWARD).toMatch(/IF NOT rpc_is_a AND NOT rpc_is_new THEN\s+RAISE EXCEPTION/);
  });

  it('pins the three profiles trigger functions to their production md5', () => {
    expect(FORWARD).toContain(`('latch_md5',        '${LATCH_MD5}')`);
    expect(FORWARD).toContain(`('billing_md5',      '${BILLING_MD5}')`);
    expect(FORWARD).toContain(`('fingerprint_md5',  '${FINGERPRINT_TRIGGER_MD5}')`);
    expect(FORWARD).toContain(
      "('trg_protect_onboarding_completed_latch', 'protect_onboarding_completed_latch', 'latch_md5')",
    );
    expect(FORWARD).toContain(
      "('trg_protect_profile_billing',            'protect_profile_billing_columns',    'billing_md5')",
    );
    expect(FORWARD).toContain(
      "('trg_set_profile_safety_fingerprint',     'set_profile_safety_fingerprint',     'fingerprint_md5')",
    );
  });

  it('aborts on any profiles user trigger outside the measured three, before and after', () => {
    const exact = "IF trg_names IS DISTINCT FROM ARRAY['trg_protect_onboarding_completed_latch',\n"
      + "                                      'trg_protect_profile_billing',\n"
      + "                                      'trg_set_profile_safety_fingerprint'] THEN";
    expect(FORWARD.split(exact)).toHaveLength(3);
  });

  it('requires the 20260915180000 column allow-list (no table-level client INSERT/UPDATE on profiles)', () => {
    expect(FORWARD).toContain("has_table_privilege(r, 'public.profiles', 'INSERT')");
    expect(FORWARD).toContain("has_table_privilege(r, 'public.profiles', 'UPDATE')");
  });

  it('accepts exactly the fresh and installed states', () => {
    expect(FORWARD).toContain('IF rpc_is_a AND NOT (have_first OR have_last OR have_op OR have_con) THEN');
    expect(FORWARD).toContain('ELSIF rpc_is_new AND have_first AND have_last AND have_op AND have_con THEN');
    expect(FORWARD).toContain("RAISE EXCEPTION 'precondition failed: partial state");
    expect(FORWARD).toContain('(is_ten AND (fn.pronargs <> 10 OR fn.pronargdefaults <> 2))');
    expect(FORWARD).toContain('(NOT is_ten AND (fn.pronargs <> 11 OR fn.pronargdefaults <> 3))');
  });
});

describe('forward migration 20261002120000: RPC signature', () => {
  it("creates migration A's argument list plus only p_operation, with DEFAULT NULL", () => {
    const aArgs = joinedLiterals(A, CREATE_FROM, CREATE_ARGS_TO);
    const cArgs = joinedLiterals(FORWARD, CREATE_FROM, CREATE_ARGS_TO);
    expect(aArgs.endsWith('p_expected_safety_fingerprint text DEFAULT NULL) ')).toBe(true);
    expect(cArgs).toBe(`${aArgs.slice(0, -2)}, p_operation text DEFAULT NULL) `);
    expect(joinedLiterals(FORWARD, "('rpc_ident',", '),'))
      .toBe(`${joinedLiterals(FORWARD, "('a_ident',", '),')}, p_operation text`);
  });

  it('drops the ten-argument function and creates, not replaces, the eleven-argument one', () => {
    expect(FORWARD).toContain(`DROP FUNCTION public.replace_user_plans_atomic(\n      ${SIG10});`);
    expect(FORWARD).not.toContain('CREATE OR REPLACE FUNCTION public.replace_user_plans_atomic');
    expect(stripComments(FORWARD)).not.toMatch(/\bCASCADE\b/);
  });

  it('re-establishes owner, revokes and the service_role grant on the eleven-argument signature', () => {
    const sig = `public.replace_user_plans_atomic(\n  ${SIG11})`;
    expect(FORWARD).toContain(`ALTER FUNCTION ${sig} OWNER TO postgres;`);
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(FORWARD).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`);
    }
    expect(FORWARD).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
    expect(FORWARD).toContain('fn.pronargs <> 11 OR fn.pronargdefaults <> 3');
    expect(FORWARD).toContain('the ten-argument migration A function still exists');
    expect(FORWARD).toContain("obj_description(rpc_oid, 'pg_proc') IS DISTINCT FROM c_comment");
  });

  it('has the C body md5 used by the rollback and the VERIFY script', () => {
    expect(md5(rpcBody(FORWARD))).toBe(C_BODY_MD5);
    expect(ROLLBACK).toContain(`('c_body_md5',   '${C_BODY_MD5}')`);
    expect(VERIFY).toContain(`md5(fn.prosrc) IS DISTINCT FROM '${C_BODY_MD5}'`);
  });
});

describe('forward migration 20261002120000: RPC body order', () => {
  const body = rpcBody(FORWARD);
  const pos = (needle) => {
    const at = body.indexOf(needle);
    expect(at).toBeGreaterThan(-1);
    return at;
  };
  const allPos = (needle) => [...body.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))]
    .map((m) => m.index);

  it('runs 22004, 22023, lock, replay, 45412, 45413, gate, archive, insert, anchors in that order', () => {
    const ownerRequired = pos("RAISE EXCEPTION 'plan_owner_id_required' USING ERRCODE = '22004';");
    const unknown = pos("RAISE EXCEPTION 'plan_operation_unknown' USING ERRCODE = '22023';");
    const lock = pos('FOR UPDATE;');
    const replayReturn = pos('RETURN QUERY SELECT v_workout_found, v_nutrition_found, true;');
    const missing = pos("RAISE EXCEPTION 'plan_owner_safety_fingerprint_missing' USING ERRCODE = '45412';");
    const changed = pos("RAISE EXCEPTION 'plan_safety_profile_changed' USING ERRCODE = '45413';");
    const gate = pos('  IF p_operation IS NOT NULL THEN\n');
    const archive = pos('UPDATE public.workout_plans');
    const insert = pos('INSERT INTO public.workout_plans');
    const anchors = pos('UPDATE public.profiles');
    const finalReturn = pos('RETURN QUERY SELECT v_workout_new, v_nutrition_new, false;');

    expect(unknown).toBeGreaterThan(ownerRequired);
    expect(lock).toBeGreaterThan(unknown);
    expect(replayReturn).toBeGreaterThan(lock);
    expect(missing).toBeGreaterThan(replayReturn);
    expect(changed).toBeGreaterThan(missing);
    expect(gate).toBeGreaterThan(changed);
    expect(archive).toBeGreaterThan(gate);
    expect(insert).toBeGreaterThan(archive);
    expect(anchors).toBeGreaterThan(insert);
    expect(finalReturn).toBeGreaterThan(anchors);

    // Every gate refusal sits between the gate and the archive.
    const refusals = [
      ...allPos("RAISE EXCEPTION 'plan_operation_not_allowed' USING ERRCODE = '45415';"),
      ...allPos("RAISE EXCEPTION 'plan_adjustment_cooldown' USING"),
    ];
    expect(refusals).toHaveLength(5);
    for (const at of refusals) {
      expect(at).toBeGreaterThan(gate);
      expect(at).toBeLessThan(archive);
    }
    expect(body).toContain("ERRCODE = '45414',");
  });

  it('writes nothing before the archive UPDATE', () => {
    const archive = pos('UPDATE public.workout_plans');
    // The auth.users row lock (FOR UPDATE) is the one allowed mention.
    const before = stripComments(body.slice(0, archive)).replace('FOR UPDATE;', '');
    expect(before).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/);
  });

  it("keeps migration A's replay branch byte-identical, with no operation in it", () => {
    const replay = (sql) => {
      const from = sql.indexOf('IF v_workout_found IS NOT NULL THEN');
      return sql.slice(from, sql.indexOf('END IF;', sql.indexOf('RETURN;', from)));
    };
    expect(replay(body)).toBe(replay(rpcBody(A)));
    expect(replay(body)).not.toMatch(/p_operation|first_plan_at|last_plan_adjustment_at/);
  });

  it("keeps migration A's lock-through-45413 span byte-identical", () => {
    const span = (sql, to) => sql.slice(sql.indexOf('  -- Per-user lock on auth.users'), sql.indexOf(to));
    expect(span(body, '  -- Operation gate.')).toBe(span(rpcBody(A), '  -- Fresh. Workout first, always.'));
  });

  it('accepts only the three operations, and NULL as legacy', () => {
    expect(body).toContain(
      "IF p_operation IS NOT NULL\n     AND p_operation NOT IN ('initial_setup', 'feedback_adjustment', 'safety_regeneration') THEN",
    );
    expect(body).toContain('TEMPORARY legacy compatibility: NULL');
  });

  it('gates initial_setup on no anchor and no rows, and feedback_adjustment on an existing plan', () => {
    expect(body).toContain('IF v_first_plan_at IS NOT NULL OR v_has_plan_rows THEN');
    expect(body).toContain('IF v_first_plan_at IS NULL AND NOT v_has_plan_rows THEN');
    expect(body).toContain('SELECT 1 FROM public.workout_plans w WHERE w.user_id = p_user_id);');
  });

  it("enforces a rolling 7 days on the server clock and reports the next time in DETAIL", () => {
    expect(body).toContain(
      "IF v_last_plan_adjustment_at IS NOT NULL\n         AND v_last_plan_adjustment_at > now() - interval '7 days' THEN",
    );
    expect(body).toContain("v_next_available_at := v_last_plan_adjustment_at + interval '7 days';");
    expect(body).toContain(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`);
    expect(body).toContain("AT TIME ZONE 'UTC'");
  });

  it('requires a token for safety_regeneration and allows only the four regeneration statuses', () => {
    const safety = body.slice(body.indexOf("ELSIF p_operation = 'safety_regeneration' THEN"));
    expect(safety.indexOf('IF p_expected_safety_fingerprint IS NULL THEN'))
      .toBeLessThan(safety.indexOf('WITH caller AS ('));
    expect(safety).toContain(
      "OR v_safety_status NOT IN ('stale', 'unverified', 'no_active_plan',\n"
      + "                                    'invalid_multiple_active_plans') THEN",
    );
    expect(safety.slice(0, safety.indexOf('  -- Fresh. Workout first'))).not.toMatch(/last_plan_adjustment_at/);
  });

  it("copies get_active_plan_safety_status's query exactly, keyed on p_user_id", () => {
    const gateBody = dollarBlock(A, 'gatebody');
    const tail = squash(gateBody.slice(gateBody.indexOf('profile AS (')));
    expect(tail.startsWith('profile AS (')).toBe(true);
    expect(tail.endsWith('LEFT JOIN active a ON s.n_active = 1')).toBe(true);
    expect(squash(body)).toContain(
      `WITH caller AS ( SELECT p_user_id AS uid ), ${tail} INTO v_safety_status, v_safety_plan_id;`,
    );
    expect(stripComments(body)).not.toContain('auth.uid()');
  });

  it('labels the plan with p_operation and moves the anchors only after both plan writes', () => {
    const insert = body.slice(body.indexOf('INSERT INTO public.workout_plans'), body.indexOf('RETURNING id INTO v_workout_new;'));
    expect(insert).toContain('client_attempt_id, safety_fingerprint, operation)');
    expect(insert).toContain('p_client_attempt_id, v_plan_safety_fingerprint, p_operation)');
    expect(body).toContain(
      'UPDATE public.profiles\n'
      + '     SET first_plan_at = COALESCE(first_plan_at, now()),\n'
      + '         last_plan_adjustment_at = CASE\n'
      + "           WHEN p_operation = 'feedback_adjustment' THEN now()\n"
      + '           ELSE last_plan_adjustment_at\n'
      + '         END\n'
      + '   WHERE id = p_user_id;',
    );
    expect(body.indexOf('UPDATE public.profiles')).toBeGreaterThan(body.indexOf('INSERT INTO public.nutrition_plans'));
  });
});

describe('forward migration 20261002120000: columns, backfill, privileges', () => {
  it('adds both anchors as plain timestamptz and grants nothing to clients', () => {
    expect(FORWARD).toContain(
      'ALTER TABLE public.profiles\n'
      + '      ADD COLUMN first_plan_at timestamptz,\n'
      + '      ADD COLUMN last_plan_adjustment_at timestamptz;',
    );
    const grants = stripComments(FORWARD).split(';').filter((s) => /\bGRANT\b/.test(s));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toContain('TO service_role');
    for (const col of [...ANCHORS, 'operation']) {
      for (const statement of statementsMentioning(FORWARD, col)) {
        expect(statement).not.toMatch(/\bGRANT\b/);
      }
    }
  });

  it('asserts anon and authenticated hold no INSERT/UPDATE on either anchor', () => {
    expect(FORWARD).toContain("FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP");
    expect(FORWARD).toContain("FOREACH col_name IN ARRAY ARRAY['first_plan_at', 'last_plan_adjustment_at'] LOOP");
    expect(FORWARD).toContain("has_column_privilege(r, 'public.profiles', col_name, 'INSERT')");
    expect(FORWARD).toContain("has_column_privilege(r, 'public.profiles', col_name, 'UPDATE')");
  });

  it('backfills first_plan_at from MIN(generated_at) only, and never last_plan_adjustment_at', () => {
    const code = stripComments(withoutRpcBody(FORWARD));
    const profileUpdates = code.split(';').filter((s) => /\bUPDATE\s+public\.profiles\b/.test(s));
    expect(profileUpdates).toHaveLength(1);
    expect(profileUpdates[0]).toContain('SET first_plan_at = m.first_generated_at');
    expect(profileUpdates[0]).toContain('min(w.generated_at) AS first_generated_at');
    expect(profileUpdates[0]).not.toContain('last_plan_adjustment_at');
  });

  it('adds workout_plans.operation with the three-value CHECK and writes no workout_plans row', () => {
    expect(FORWARD).toContain(
      "CHECK (operation IS NULL OR operation IN ('initial_setup', 'feedback_adjustment', 'safety_regeneration'));",
    );
    for (const op of OPERATIONS) expect(FORWARD).toContain(`'${op}'::text`);
    const code = stripComments(withoutRpcBody(FORWARD));
    expect(code).not.toMatch(/\bUPDATE\s+(public\.)?workout_plans\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\s+(public\.)?workout_plans\b/i);
    expect(code).not.toMatch(/\bINSERT\s+INTO\s+(public\.)?workout_plans\b/i);
  });

  it('creates the user_id index only when none exists, with a marker comment', () => {
    expect(FORWARD).toContain("NOT is_installed AND NOT plain_user_idx");
    expect(FORWARD).toContain('CREATE INDEX workout_plans_user_id_idx\n      ON public.workout_plans USING btree (user_id);');
    expect(FORWARD).toContain("('index_marker',     'created by 20261002120000_plan_operation_cooldown')");
  });

  it('notifies PostgREST right before COMMIT and ends with COMMIT', () => {
    expect(stripComments(FORWARD).trimEnd()).toMatch(/NOTIFY pgrst, 'reload schema';\s*COMMIT;$/);
    expect(FORWARD).toMatch(/^BEGIN;$/m);
    expect(FORWARD).toContain("SET LOCAL lock_timeout = '5s';");
    expect(FORWARD).toMatch(/^-- UNEXECUTED\./m);
  });
});

describe('rollback 20261002120001', () => {
  it("restores a body whose text equals migration A's body", () => {
    const restored = rpcBody(ROLLBACK);
    expect(restored).toBe(rpcBody(A));
    expect(md5(restored)).toBe(A_BODY_MD5);
    expect(ROLLBACK).toContain(`('a_body_md5',   '${A_BODY_MD5}')`);
    expect(ROLLBACK).toContain(`IS DISTINCT FROM '${A_BODY_MD5}' THEN`);
  });

  it("drops the eleven-argument function and creates migration A's argument list", () => {
    expect(ROLLBACK).toContain(`DROP FUNCTION public.replace_user_plans_atomic(\n      ${SIG11});`);
    expect(joinedLiterals(ROLLBACK, CREATE_FROM, CREATE_ARGS_TO)).toBe(joinedLiterals(A, CREATE_FROM, CREATE_ARGS_TO));
    expect(ROLLBACK).toContain(`GRANT EXECUTE ON FUNCTION public.replace_user_plans_atomic(\n  ${SIG10}) TO service_role;`);
    expect(stripComments(ROLLBACK)).not.toMatch(/\bCASCADE\b/);
  });

  it('drops the CHECK, the column, the marked index only, and both anchors', () => {
    expect(ROLLBACK).toContain('DROP CONSTRAINT IF EXISTS workout_plans_operation_valid;');
    expect(ROLLBACK).toContain('DROP COLUMN IF EXISTS operation;');
    expect(ROLLBACK).toMatch(/IS NOT DISTINCT FROM \(SELECT v FROM _poc_const WHERE k = 'index_marker'\) THEN\s+DROP INDEX public\.workout_plans_user_id_idx;/);
    expect(ROLLBACK).toContain('DROP COLUMN IF EXISTS first_plan_at,\n  DROP COLUMN IF EXISTS last_plan_adjustment_at;');
  });

  it('is manual-only, states the data loss, and ends with NOTIFY and COMMIT', () => {
    expect(ROLLBACK).toMatch(/^-- UNEXECUTED\. Manual rollback only\./m);
    expect(ROLLBACK).toContain('every running cooldown is reset');
    expect(stripComments(ROLLBACK).trimEnd()).toMatch(/NOTIFY pgrst, 'reload schema';\s*COMMIT;$/);
  });
});

describe('VERIFY_plan_operation_cooldown', () => {
  it('ends in ROLLBACK and never commits', () => {
    const code = stripComments(VERIFY);
    expect(code.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(code).not.toMatch(/\bCOMMIT\s*;/i);
  });

  it('contains the placeholder guard', () => {
    expect(VERIFY).toContain("'00000000-0000-0000-0000-000000000000',");
    expect(VERIFY).toContain("IF v_uid = '00000000-0000-0000-0000-000000000000' THEN");
  });

  it('checks the catalog: arity, defaults, CHECK, client privileges, trigger pins', () => {
    expect(VERIFY).toContain('fn.pronargs <> 11 OR fn.pronargdefaults <> 3');
    expect(VERIFY).toContain("p_expected_safety_fingerprint text, p_operation text' THEN");
    for (const value of [LATCH_MD5, BILLING_MD5, FINGERPRINT_TRIGGER_MD5]) {
      expect(VERIFY).toContain(`'${value}'`);
    }
    expect(VERIFY).toContain("has_column_privilege(r, 'public.profiles', col_name, 'UPDATE')");
    expect(dollarBlock(VERIFY, 'chk')).toBe(dollarBlock(FORWARD, 'chk'));
  });

  it('exercises every gate branch', () => {
    for (const expected of [
      "'22023', 'plan_operation_unknown'",
      "'45415', 'plan_operation_not_allowed'",
      "'45414', 'plan_adjustment_cooldown'",
      "'45413', 'plan_safety_profile_changed'",
      "pg_temp.verify_saved('6 initial_setup', 'initial_setup'",
      "pg_temp.verify_saved('9 feedback_adjustment', 'feedback_adjustment'",
      "pg_temp.verify_saved('12 legacy', NULL, NULL",
      "pg_temp.verify_saved('14 safety_regeneration unverified', 'safety_regeneration'",
      "pg_temp.verify_saved('16 safety_regeneration stale', 'safety_regeneration'",
      "pg_temp.verify_saved('17 safety_regeneration no_active_plan', 'safety_regeneration'",
      "pg_temp.verify_saved('18b exactly 7 days', 'feedback_adjustment'",
      "v_res.o_replayed IS DISTINCT FROM true",
    ]) {
      expect(VERIFY).toContain(expected);
    }
  });

  it('never deletes a plan row (workout_sessions references workout_plans)', () => {
    expect(stripComments(VERIFY)).not.toMatch(/\bDELETE\b/i);
  });
});

describe('VERIFY_profile_safety_fingerprint after migration C', () => {
  it('carries the superseded note at the top', () => {
    expect(VERIFY_A.startsWith('-- SUPERSEDED after 20261002120000_plan_operation_cooldown.sql')).toBe(true);
    expect(VERIFY_A).toContain('use VERIFY_plan_operation_cooldown.sql instead');
  });
});
