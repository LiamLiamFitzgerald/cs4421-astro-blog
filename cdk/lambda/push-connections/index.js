/**
 * The rooms WebSocket's connect and disconnect handler (ADR-019). It records
 * which screens are watching which room, in the rooms table:
 *
 *   pk = ROOM#<code>  sk = CONN#<id>   the room's screens (the app posts to these)
 *   pk = CONN#<id>    sk = CONN        which room a connection watches (for disconnect)
 *
 * Plain JavaScript with the low-level DynamoDB client that the Lambda Node.js
 * runtime already includes, so nothing needs bundling. `makeHandler` takes the
 * client's send function, so the logic is tested without AWS.
 */
'use strict';

const CODE = /^[A-Z]{4}$/;
/** API Gateway closes a socket after 2 hours at most; the records go too. */
const CONNECTION_SECONDS = 2 * 60 * 60;

function makeHandler(send, table, now = () => Date.now()) {
  return async (event) => {
    const { routeKey, connectionId } = event.requestContext;
    if (routeKey === '$connect') {
      const code = (event.queryStringParameters || {}).code || '';
      if (!CODE.test(code)) return { statusCode: 400, body: 'code must be a 4-letter room code' };
      const expiresAt = { N: String(Math.floor(now() / 1000) + CONNECTION_SECONDS) };
      await Promise.all([
        send('PutItem', { TableName: table, Item: { pk: { S: `ROOM#${code}` }, sk: { S: `CONN#${connectionId}` }, expiresAt } }),
        send('PutItem', {
          TableName: table,
          Item: { pk: { S: `CONN#${connectionId}` }, sk: { S: 'CONN' }, code: { S: code }, expiresAt },
        }),
      ]);
      return { statusCode: 200 };
    }
    if (routeKey === '$disconnect') {
      const link = await send('GetItem', { TableName: table, Key: { pk: { S: `CONN#${connectionId}` }, sk: { S: 'CONN' } } });
      const code = link && link.Item && link.Item.code && link.Item.code.S;
      await Promise.all([
        send('DeleteItem', { TableName: table, Key: { pk: { S: `CONN#${connectionId}` }, sk: { S: 'CONN' } } }),
        ...(code ? [send('DeleteItem', { TableName: table, Key: { pk: { S: `ROOM#${code}` }, sk: { S: `CONN#${connectionId}` } } })] : []),
      ]);
      return { statusCode: 200 };
    }
    // Screens never send messages; anything else is ignored.
    return { statusCode: 200 };
  };
}

/** The real handler, created on first use so tests can load this file without the AWS SDK. */
let real;
exports.handler = async (event) => {
  if (!real) {
    const sdk = require('@aws-sdk/client-dynamodb');
    const client = new sdk.DynamoDBClient({});
    const commands = { PutItem: sdk.PutItemCommand, GetItem: sdk.GetItemCommand, DeleteItem: sdk.DeleteItemCommand };
    real = makeHandler((name, input) => client.send(new commands[name](input)), process.env.ROOMS_TABLE);
  }
  return real(event);
};
exports.makeHandler = makeHandler;
