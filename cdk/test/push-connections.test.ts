// eslint-disable-next-line @typescript-eslint/no-require-imports
const { makeHandler } = require('../lambda/push-connections/index.js') as {
  makeHandler: (
    send: (name: string, input: Record<string, unknown>) => Promise<unknown>,
    table: string,
    now?: () => number,
  ) => (event: unknown) => Promise<{ statusCode: number }>;
};

const event = (routeKey: string, connectionId: string, code?: string) => ({
  requestContext: { routeKey, connectionId },
  queryStringParameters: code === undefined ? undefined : { code },
});

function recorder(answers: Record<string, unknown> = {}) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const send = async (name: string, input: Record<string, unknown>) => {
    calls.push({ name, input });
    return answers[name] ?? {};
  };
  return { calls, send };
}

describe('Feature: recording which screens watch a room (ADR-019)', () => {
  it('given a connect with a room code, records both directions with a two-hour expiry', async () => {
    const { calls, send } = recorder();
    const handler = makeHandler(send, 'Rooms', () => 1_000_000);
    expect(await handler(event('$connect', 'c1', 'ABCD'))).toEqual({ statusCode: 200 });
    expect(calls).toEqual([
      { name: 'PutItem', input: { TableName: 'Rooms', Item: { pk: { S: 'ROOM#ABCD' }, sk: { S: 'CONN#c1' }, expiresAt: { N: '8200' } } } },
      {
        name: 'PutItem',
        input: { TableName: 'Rooms', Item: { pk: { S: 'CONN#c1' }, sk: { S: 'CONN' }, code: { S: 'ABCD' }, expiresAt: { N: '8200' } } },
      },
    ]);
  });

  it.each([undefined, '', 'abcd', 'ABCDE', 'AB1D'])('given a connect with code %p, refuses it and writes nothing', async (code) => {
    const { calls, send } = recorder();
    expect((await makeHandler(send, 'Rooms')(event('$connect', 'c1', code))).statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('given a disconnect, removes both records', async () => {
    const { calls, send } = recorder({ GetItem: { Item: { code: { S: 'ABCD' } } } });
    await makeHandler(send, 'Rooms')(event('$disconnect', 'c1'));
    expect(calls.map((c) => [c.name, c.input['Key']])).toEqual([
      ['GetItem', { pk: { S: 'CONN#c1' }, sk: { S: 'CONN' } }],
      ['DeleteItem', { pk: { S: 'CONN#c1' }, sk: { S: 'CONN' } }],
      ['DeleteItem', { pk: { S: 'ROOM#ABCD' }, sk: { S: 'CONN#c1' } }],
    ]);
  });

  it('given a disconnect for an unknown connection, only tidies its own record', async () => {
    const { calls, send } = recorder({ GetItem: {} });
    await makeHandler(send, 'Rooms')(event('$disconnect', 'c9'));
    expect(calls.map((c) => c.name)).toEqual(['GetItem', 'DeleteItem']);
  });

  it('given any other message, does nothing', async () => {
    const { calls, send } = recorder();
    expect(await makeHandler(send, 'Rooms')(event('$default', 'c1'))).toEqual({ statusCode: 200 });
    expect(calls).toEqual([]);
  });
});
