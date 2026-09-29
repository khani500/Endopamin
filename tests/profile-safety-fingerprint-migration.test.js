import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static contract over migration A, its rollback and its VERIFY script.
// Text assertions only: nothing here touches a database.

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
const read = (name) => readFileSync(new URL(name, MIGRATIONS), 'utf8');

const M4 = read('20260911140000_plan_replacement_rpc.sql');
const FORWARD = read('20260928140000_profile_safety_fingerprint.sql');
const ROLLBACK = read('20260928140001_drop_profile_safety_fingerprint.sql');
const VERIFY = read('VERIFY_profile_safety_fingerprint.sql');

const M4_BODY_MD5 = '1b0241b82984a66de984e0d536b6838d';
const NEW_PARAM = 'p_expected_safety_fingerprint';
const FINGERPRINT_FUNCTIONS = ['profile_safety_fingerprint', 'set_profile_safety_fingerprint'];
const GATE = 'get_active_plan_safety_status';
const SIG9 = 'uuid, uuid, text, text, date, integer, date, jsonb, jsonb';
const SIG10 = `${SIG9}, text`;

const md5 = (text) => createHash('md5').update(text).digest('hex');

// The one $tag$ ... $tag$ block with this tag in the file.
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

// Concatenated '...' || '...' literals after `from` and before `to`, joined.
function joinedLiterals(sql, from, to) {
  const start = sql.indexOf(from);
  const end = sql.indexOf(to, start + from.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...sql.slice(start + from.length, end).matchAll(/'([^']*)'/g)].map((m) => m[1]).join('');
}

// SQL statements (comments stripped) that mention `word`.
function statementsMentioning(sql, word) {
  return stripComments(sql)
    .split(';')
    .filter((s) => new RegExp(`\\b${word}\\b`).test(s));
}

const M4_CREATE_FROM = "'CREATE FUNCTION public.replace_user_plans_atomic('";
const CREATE_ARGS_TO = "|| 'RETURNS TABLE";
const M4_ARGS = joinedLiterals(M4, M4_CREATE_FROM, CREATE_ARGS_TO);
const M4_IDENT = joinedLiterals(M4, 'expect_ident CONSTANT text :=', ';');

describe('forward migration 20260928140000: RPC signature', () => {
  it('guards on the measured M4 body md5 before replacing the RPC', () => {
    expect(FORWARD).toContain(`('m4_body_md5', '${M4_BODY_MD5}')`);
    expect(FORWARD).toContain('rpc_is_m4  := is_nine AND md5(fn.prosrc) = c_m4_md5;');
    expect(FORWARD).toMatch(/IF NOT rpc_is_m4 AND NOT rpc_is_new THEN\s+RAISE EXCEPTION/);
  });

  it('keeps the M4 identity arguments as the fresh-state contract and adds exactly one', () => {
    expect(M4_IDENT).toContain('p_nutrition_plan_data jsonb');
    expect(joinedLiterals(FORWARD, "('m4_ident',", '),')).toBe(M4_IDENT);
    expect(joinedLiterals(FORWARD, "('rpc_ident',", '),')).toBe(`${M4_IDENT}, ${NEW_PARAM} text`);
  });

  it('creates the M4 argument list plus only the new parameter, with DEFAULT NULL', () => {
    const fwdArgs = joinedLiterals(FORWARD, M4_CREATE_FROM, CREATE_ARGS_TO);
    expect(M4_ARGS.endsWith('p_nutrition_plan_data jsonb DEFAULT NULL) ')).toBe(true);
    expect(fwdArgs).toBe(
      `${M4_ARGS.slice(0, -2)}, ${NEW_PARAM} text DEFAULT NULL) `,
    );
    expect(FORWARD).toContain(
      "|| 'RETURNS TABLE (workout_plan_id uuid, nutrition_plan_id uuid, replayed boolean) '\n"
      + "      || 'LANGUAGE plpgsql VOLATILE SECURITY DEFINER '\n"
      + "      || 'SET search_path = public, pg_temp '",
    );
  });

  it('names no fingerprint parameter other than the token', () => {
    const names = new Set([...FORWARD.matchAll(/\bp_\w*fingerprint\b/g)].map((m) => m[0]));
    expect([...names]).toEqual([NEW_PARAM]);
  });

  it('drops the nine-argument function and creates, not replaces, the ten-argument one', () => {
    expect(FORWARD).toContain(
      `DROP FUNCTION public.replace_user_plans_atomic(\n      ${SIG9});`,
    );
    expect(FORWARD).not.toContain('CREATE OR REPLACE FUNCTION public.replace_user_plans_atomic');
    expect(stripComments(FORWARD)).not.toMatch(/\bCASCADE\b/);
  });

  it('re-establishes owner, revokes and the service_role grant on the ten-argument signature', () => {
    const sig = `public.replace_user_plans_atomic(\n  ${SIG10})`;
    expect(FORWARD).toContain(`ALTER FUNCTION ${sig} OWNER TO postgres;`);
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(FORWARD).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`);
    }
    expect(FORWARD).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
  });

  it('asserts the ten-argument arity and a single function afterwards', () => {
    expect(FORWARD).toContain('fn.pronargs <> 10 OR fn.pronargdefaults <> 2');
    expect(FORWARD).toContain('the nine-argument M4 function still exists');
    expect(FORWARD).toContain("obj_description(rpc_oid, 'pg_proc') IS DISTINCT FROM c_comment");
  });
});

describe('forward migration 20260928140000: RPC body', () => {
  const body = rpcBody(FORWARD);
  const pos = (needle) => {
    const at = body.indexOf(needle);
    expect(at).toBeGreaterThan(-1);
    return at;
  };

  it('raises 45412 and 45413 on the fresh path, after the lock and replay, before the archive UPDATE', () => {
    const lock = pos('FOR UPDATE;');
    const replayReturn = pos('RETURN QUERY SELECT v_workout_found, v_nutrition_found, true;');
    const missing = pos("RAISE EXCEPTION 'plan_owner_safety_fingerprint_missing' USING ERRCODE = '45412';");
    const changed = pos("RAISE EXCEPTION 'plan_safety_profile_changed' USING ERRCODE = '45413';");
    const archive = pos('UPDATE public.workout_plans');
    const insert = pos('INSERT INTO public.workout_plans');
    expect(replayReturn).toBeGreaterThan(lock);
    expect(missing).toBeGreaterThan(replayReturn);
    expect(changed).toBeGreaterThan(missing);
    expect(archive).toBeGreaterThan(changed);
    expect(insert).toBeGreaterThan(archive);
    expect(body.indexOf('UPDATE ')).toBe(archive);
  });

  it('compares the token only when it is not NULL', () => {
    expect(body).toContain(
      `IF ${NEW_PARAM} IS NOT NULL\n     AND ${NEW_PARAM} IS DISTINCT FROM v_profile_safety_fingerprint THEN`,
    );
  });

  it('inserts the value read from profiles, never the parameter', () => {
    const insert = body.slice(body.indexOf('INSERT INTO public.workout_plans'), body.indexOf('RETURNING id INTO v_workout_new;'));
    expect(insert).toContain('client_attempt_id, safety_fingerprint)');
    expect(insert).toContain('p_client_attempt_id, v_plan_safety_fingerprint)');
    expect(insert).not.toContain(NEW_PARAM);

    expect(body).toContain('SELECT p.safety_fingerprint INTO v_profile_safety_fingerprint\n    FROM public.profiles p');
    const assignments = [...body.matchAll(/v_plan_safety_fingerprint :=\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(assignments.sort()).toEqual(['NULL', 'v_profile_safety_fingerprint']);
    expect(body).not.toMatch(new RegExp(`:=\\s*${NEW_PARAM}`));
  });

  it('marks the NULL-token path as temporary legacy compatibility', () => {
    expect(body).toContain('TEMPORARY legacy compatibility');
    expect(body).toContain('Close this');
  });

  it('keeps the replay branch byte-identical to M4', () => {
    const replay = (sql) => {
      const from = sql.indexOf('IF v_workout_found IS NOT NULL THEN');
      return sql.slice(from, sql.indexOf('END IF;', sql.indexOf('RETURN;', from)));
    };
    expect(replay(body)).toBe(replay(rpcBody(M4)));
    expect(replay(body)).not.toMatch(/fingerprint/);
  });
});

describe('forward migration 20260928140000: gate and the rest', () => {
  const gateBody = dollarBlock(FORWARD, 'gatebody');

  it('creates get_active_plan_safety_status with no parameters, SECURITY INVOKER, STABLE sql', () => {
    const create = joinedLiterals(FORWARD, `'CREATE FUNCTION public.${GATE}() '`, "|| 'AS '");
    expect(create).toBe(
      'RETURNS TABLE (status text, plan_id uuid) '
      + 'LANGUAGE sql STABLE SECURITY INVOKER '
      + 'SET search_path = public, pg_temp ',
    );
    expect(create).not.toMatch(/SECURITY DEFINER/);
  });

  it('reads only through auth.uid() and never writes', () => {
    const code = stripComments(gateBody);
    expect(code).toContain('auth.uid()');
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i);
    for (const status of [
      'profile_unavailable', 'no_active_plan', 'invalid_multiple_active_plans',
      'unverified', 'stale', 'valid',
    ]) {
      expect(code).toContain(`'${status}'`);
    }
  });

  it('is granted to authenticated only, and revoked from PUBLIC and anon', () => {
    const grants = statementsMentioning(FORWARD, GATE).filter((s) => /\bGRANT\b/.test(s));
    expect(grants).toHaveLength(1);
    expect(grants[0].trim()).toBe(`GRANT EXECUTE ON FUNCTION public.${GATE}() TO authenticated`);
    expect(FORWARD).toContain(`REVOKE ALL ON FUNCTION public.${GATE}() FROM PUBLIC;`);
    expect(FORWARD).toContain(`REVOKE ALL ON FUNCTION public.${GATE}() FROM anon;`);
  });

  it('creates the profiles trigger BEFORE INSERT OR UPDATE FOR EACH ROW', () => {
    expect(FORWARD).toMatch(
      /CREATE TRIGGER trg_set_profile_safety_fingerprint\s+BEFORE INSERT OR UPDATE ON public\.profiles\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.set_profile_safety_fingerprint\(\);/,
    );
  });

  it('checks the trigger by catalog columns, testing an empty column list with cardinality', () => {
    // An empty int2vector cast to int2[] has one dimension and length 0, so
    // array_length(tgattr::int2[], 1) is 0, never NULL. That broke dry run 2.
    expect(FORWARD).not.toMatch(/array_length\([^)]*tgattr/);
    expect(FORWARD.match(/OR cardinality\(trg\.tgattr::int2\[\]\) <> 0 THEN/g)).toHaveLength(2);
    expect(FORWARD.match(/OR trg\.tgfoid <> 'public\.set_profile_safety_fingerprint\(\)'::regprocedure/g)).toHaveLength(2);
  });

  it('contains no REVOKE on the two fingerprint functions', () => {
    for (const statement of stripComments(FORWARD).split(';')) {
      if (!/\bREVOKE\b/i.test(statement)) continue;
      for (const name of FINGERPRINT_FUNCTIONS) {
        expect(statement).not.toMatch(new RegExp(`\\b${name}\\b`, 'i'));
      }
    }
  });

  it('contains no write to workout_plans rows outside the RPC body', () => {
    const code = stripComments(withoutRpcBody(FORWARD));
    expect(code).not.toMatch(/\bUPDATE\s+(public\.)?workout_plans\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\s+(public\.)?workout_plans\b/i);
    expect(code).not.toMatch(/\bINSERT\s+INTO\s+(public\.)?workout_plans\b/i);
  });

  it('notifies PostgREST right before COMMIT and ends with COMMIT', () => {
    const code = stripComments(FORWARD).trimEnd();
    expect(code).toMatch(/NOTIFY pgrst, 'reload schema';\s*COMMIT;$/);
    expect(FORWARD).toMatch(/^BEGIN;$/m);
  });
});

describe('rollback 20260928140001', () => {
  it('guards on migration A body md5', () => {
    expect(ROLLBACK).toContain(`('a_body_md5',  '${md5(rpcBody(FORWARD))}')`);
  });

  it('drops the ten-argument function and creates the M4 function with the M4 argument list', () => {
    expect(ROLLBACK).toContain(
      `DROP FUNCTION public.replace_user_plans_atomic(\n      ${SIG10});`,
    );
    expect(joinedLiterals(ROLLBACK, M4_CREATE_FROM, CREATE_ARGS_TO)).toBe(M4_ARGS);
    expect(ROLLBACK).toContain(`GRANT EXECUTE ON FUNCTION public.replace_user_plans_atomic(\n  ${SIG9}) TO service_role;`);
  });

  it('restores a body whose text equals the M4 body', () => {
    const restored = rpcBody(ROLLBACK);
    expect(restored).toBe(rpcBody(M4));
    expect(md5(restored)).toBe(M4_BODY_MD5);
  });

  it('drops the gate, notifies PostgREST and ends with COMMIT', () => {
    expect(ROLLBACK).toContain(`DROP FUNCTION IF EXISTS public.${GATE}();`);
    expect(stripComments(ROLLBACK).trimEnd()).toMatch(/NOTIFY pgrst, 'reload schema';\s*COMMIT;$/);
  });

  it('is marked UNEXECUTED and states the data loss', () => {
    expect(ROLLBACK).toMatch(/^-- UNEXECUTED\./m);
    expect(ROLLBACK).toContain('fingerprints of every plan saved after migration A are lost');
  });
});

describe('VERIFY_profile_safety_fingerprint', () => {
  it('ends in ROLLBACK and never commits', () => {
    const code = stripComments(VERIFY);
    expect(code.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(code).not.toMatch(/\bCOMMIT\s*;/i);
  });

  it('contains the placeholder guard', () => {
    expect(VERIFY).toContain("'00000000-0000-0000-0000-000000000000',");
    expect(VERIFY).toContain("IF v_uid = '00000000-0000-0000-0000-000000000000' THEN");
    expect(VERIFY).toContain("'VERIFY: replace verify.uid with a sacrificial profiles.id you control'");
  });

  it("checks the RPC body against migration A's body md5 and exercises the token", () => {
    expect(VERIFY).toContain(`md5(fn.prosrc) IS DISTINCT FROM '${md5(rpcBody(FORWARD))}'`);
    expect(VERIFY).toContain("EXCEPTION WHEN SQLSTATE '45413' THEN");
    expect(VERIFY).toContain(`${NEW_PARAM} := NULL`);
    expect(VERIFY).toContain(`public.${GATE}()`);
  });
});
