import { describe, expect, it } from 'vitest';
import {
  handleRequest,
  planProfileWrite,
} from '../api/save-profile.js';

const NOW = new Date('2026-09-14T21:00:00.000Z');
const STAMP = {
  at: NOW.toISOString(),
  source: 'save-profile',
};

function fields(entries) {
  return { fields: entries };
}

function expectNoWrite(result) {
  expect(result.value).toBeUndefined();
  expect(result.error).toEqual(expect.any(Object));
}

function fakeRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    headersSent: false,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

function fakeAdmin({ profile, userId = 'user-1' } = {}) {
  const updates = [];
  const tables = [];
  return {
    updates,
    tables,
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    from(table) {
      tables.push(table);
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: profile, error: null }),
              };
            },
          };
        },
        update(patch) {
          updates.push({ table, patch });
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
  };
}

async function postSave(body, { profile, admin } = {}) {
  const client = admin || fakeAdmin({
    profile: profile || {
      height_unit: 'cm',
      weight_unit: 'lb',
      weight: 180,
      goal: 'fat_loss',
      field_provenance: null,
    },
  });
  const res = fakeRes();
  await handleRequest(
    {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-length': '128' },
      body,
    },
    res,
    'abcd1234',
    { admin: client },
  );
  return { res, admin: client };
}

describe('planProfileWrite', () => {
  it('stamps a confirmed valid field as confirmed and includes it in the write', () => {
    const result = planProfileWrite(
      fields({ age: { value: 28, intent: 'confirmed' } }),
      { now: NOW },
    );

    expect(result.error).toBeUndefined();
    expect(result.value.written).toEqual({ age: { state: 'confirmed' } });
    expect(result.value.patch).toEqual({
      age: 28,
      field_provenance: { age: { state: 'confirmed', ...STAMP } },
    });
  });

  it('rejects a confirmed invalid field with 422 and no patch', () => {
    const invalid = planProfileWrite(
      fields({ age: { value: 14, intent: 'confirmed' } }),
      { now: NOW },
    );
    expectNoWrite(invalid);
    expect(invalid.error.status).toBe(422);
    expect(invalid.error.fields.age).toEqual(expect.any(String));

    const valid = planProfileWrite(
      fields({ age: { value: 16, intent: 'confirmed' } }),
      { now: NOW },
    );
    expect(valid.value.patch.age).toBe(16);
    expect(valid.value.written.age.state).toBe('confirmed');
  });

  it('leaves an absent field value and prior provenance untouched', () => {
    const prior = {
      goal: { state: 'confirmed', at: '2026-01-01T00:00:00.000Z', source: 'save-profile' },
    };
    const result = planProfileWrite(
      fields({ age: { value: 28, intent: 'confirmed' } }),
      {
        existing: { field_provenance: prior, goal: 'fat_loss' },
        now: NOW,
      },
    );

    expect(result.value.patch).not.toHaveProperty('goal');
    expect(result.value.patch.field_provenance.goal).toEqual(prior.goal);
    expect(result.value.patch.field_provenance.age.state).toBe('confirmed');
    expect(result.value.written).toEqual({ age: { state: 'confirmed' } });
  });

  it('clears a clearable field as SQL NULL and stamps cleared', () => {
    const result = planProfileWrite(
      fields({ injuries: { intent: 'cleared' } }),
      { now: NOW },
    );

    expect(result.value.patch.injuries).toBeNull();
    expect(result.value.written.injuries).toEqual({ state: 'cleared' });
    expect(result.value.patch.field_provenance.injuries).toEqual({
      state: 'cleared',
      ...STAMP,
    });
  });

  it('rejects clearing a non-clearable field', () => {
    const result = planProfileWrite(
      fields({ goal: { intent: 'cleared' } }),
      { now: NOW },
    );
    expectNoWrite(result);
    expect(result.error.status).toBe(400);
    expect(result.error.field).toBe('goal');

    const neighbour = planProfileWrite(
      fields({ goal: { value: 'fat_loss', intent: 'confirmed' } }),
      { now: NOW },
    );
    expect(neighbour.value.patch.goal).toBe('fat_loss');
  });

  it('ignores a client-supplied provenance state and derives confirmed from intent', () => {
    const result = planProfileWrite(
      {
        fields: {
          age: { value: 28, intent: 'confirmed', state: 'cleared' },
        },
        provenance: {
          age: { state: 'cleared', at: '2020-01-01T00:00:00.000Z', source: 'client' },
        },
      },
      { now: NOW },
    );

    expect(result.value.written.age.state).toBe('confirmed');
    expect(result.value.patch.field_provenance.age).toEqual({
      state: 'confirmed',
      ...STAMP,
    });
    expect(result.value.patch.field_provenance.age.source).toBe('save-profile');
  });

  it('rejects a request that contains not_loaded', () => {
    const result = planProfileWrite(
      fields({ age: { value: 28, intent: 'not_loaded' } }),
      { now: NOW },
    );
    expectNoWrite(result);
    expect(result.error.status).toBe(400);
    expect(result.error.message).toMatch(/not_loaded/);

    const neighbour = planProfileWrite(
      fields({ age: { value: 28, intent: 'confirmed' } }),
      { now: NOW },
    );
    expect(neighbour.value.patch.age).toBe(28);
  });

  it('writes nothing for a mixed request when one field is invalid', () => {
    const mixed = planProfileWrite(
      fields({
        age: { value: 28, intent: 'confirmed' },
        experience: { value: 'athlete', intent: 'confirmed' },
      }),
      { now: NOW },
    );
    expectNoWrite(mixed);
    expect(mixed.error.status).toBe(422);
    expect(mixed.error.fields.experience).toEqual(expect.any(String));
    expect(mixed.error.fields).not.toHaveProperty('age');

    const neighbour = planProfileWrite(
      fields({
        age: { value: 28, intent: 'confirmed' },
        experience: { value: 'advanced', intent: 'confirmed' },
      }),
      { now: NOW },
    );
    expect(neighbour.value.patch).toMatchObject({ age: 28, experience: 'advanced' });
    expect(neighbour.value.written).toEqual({
      age: { state: 'confirmed' },
      experience: { state: 'confirmed' },
    });
  });

  it('does not write billing columns or owner ids', () => {
    expectNoWrite(planProfileWrite({
      fields: { age: { value: 28, intent: 'confirmed' } },
      user_id: 'attacker',
    }));
    expectNoWrite(planProfileWrite(
      fields({ is_pro: { value: true, intent: 'confirmed' } }),
    ));
  });
});

describe('handleRequest', () => {
  it('writes a confirmed valid field and never touches another table', async () => {
    const { res, admin } = await postSave(
      fields({ age: { value: 28, intent: 'confirmed' } }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.written.age).toEqual({ state: 'confirmed' });
    expect(res.body.requestId).toBe('abcd1234');
    expect(admin.updates).toHaveLength(1);
    expect(admin.updates[0].table).toBe('profiles');
    expect(admin.updates[0].patch.age).toBe(28);
    expect(admin.updates[0].patch.field_provenance.age.state).toBe('confirmed');
    expect(admin.tables.every(table => table === 'profiles')).toBe(true);
    expect(admin.updates[0].patch).not.toHaveProperty('is_pro');
  });

  it('returns 422 and writes nothing when a confirmed field is invalid', async () => {
    const { res, admin } = await postSave(
      fields({ age: { value: 14, intent: 'confirmed' } }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.body.fields.age).toEqual(expect.any(String));
    expect(admin.updates).toHaveLength(0);

    const neighbour = await postSave(
      fields({ age: { value: 16, intent: 'confirmed' } }),
    );
    expect(neighbour.res.statusCode).toBe(200);
    expect(neighbour.admin.updates).toHaveLength(1);
  });

  it('does not write an absent field or its prior provenance', async () => {
    const prior = {
      goal: { state: 'confirmed', at: '2026-01-01T00:00:00.000Z', source: 'save-profile' },
    };
    const { res, admin } = await postSave(
      fields({ age: { value: 28, intent: 'confirmed' } }),
      {
        profile: {
          height_unit: 'cm',
          weight_unit: 'lb',
          weight: 180,
          goal: 'fat_loss',
          field_provenance: prior,
        },
      },
    );

    expect(res.statusCode).toBe(200);
    expect(admin.updates[0].patch).not.toHaveProperty('goal');
    expect(admin.updates[0].patch.field_provenance.goal).toEqual(prior.goal);
  });

  it('clears a clearable field as NULL', async () => {
    const { res, admin } = await postSave(
      fields({ target_weight: { intent: 'cleared' } }),
    );
    expect(res.statusCode).toBe(200);
    expect(admin.updates[0].patch.target_weight).toBeNull();
    expect(admin.updates[0].patch.field_provenance.target_weight.state).toBe('cleared');
  });

  it('rejects clearing a non-clearable field without writing', async () => {
    const { res, admin } = await postSave(
      fields({ experience: { intent: 'cleared' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(admin.updates).toHaveLength(0);

    const neighbour = await postSave(
      fields({ experience: { value: 'intermediate', intent: 'confirmed' } }),
    );
    expect(neighbour.res.statusCode).toBe(200);
    expect(neighbour.admin.updates).toHaveLength(1);
  });

  it('ignores client-supplied provenance on the wire', async () => {
    const { res, admin } = await postSave({
      fields: { age: { value: 28, intent: 'confirmed' } },
      provenance: { age: { state: 'cleared' } },
    });
    expect(res.statusCode).toBe(200);
    expect(admin.updates[0].patch.field_provenance.age.state).toBe('confirmed');
  });

  it('rejects not_loaded and writes nothing', async () => {
    const { res, admin } = await postSave(
      fields({ age: { value: 28, intent: 'not_loaded' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(admin.updates).toHaveLength(0);
  });

  it('writes nothing at all when one field in a mixed request is invalid', async () => {
    const { res, admin } = await postSave(fields({
      age: { value: 28, intent: 'confirmed' },
      goal: { value: 'muscle', intent: 'confirmed' },
    }));
    expect(res.statusCode).toBe(422);
    expect(res.body.fields.goal).toEqual(expect.any(String));
    expect(admin.updates).toHaveLength(0);

    const neighbour = await postSave(fields({
      age: { value: 28, intent: 'confirmed' },
      goal: { value: 'muscle_gain', intent: 'confirmed' },
    }));
    expect(neighbour.res.statusCode).toBe(200);
    expect(neighbour.admin.updates).toHaveLength(1);
    expect(neighbour.admin.updates[0].patch).toMatchObject({
      age: 28,
      goal: 'muscle_gain',
    });
  });
});
