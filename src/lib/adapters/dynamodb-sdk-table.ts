import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Item, Table } from "./dynamodb-room-repository";

/** The part of the document client this needs, so tests can record calls. */
export type Sender = Pick<DynamoDBDocumentClient, "send">;

const conditionFailed = (error: unknown) =>
  error instanceof Error && (error.name === "ConditionalCheckFailedException" || error.name === "TransactionCanceledException");

/**
 * The Table operations on real DynamoDB (ADR-019). Reads are strongly
 * consistent, so a screen never sees an older log than the one it was told about.
 */
export function sdkTable(client: Sender, tableName: string): Table {
  return {
    async putIfAbsent(item) {
      try {
        await client.send(
          new PutCommand({ TableName: tableName, Item: item, ConditionExpression: "attribute_not_exists(pk)" }),
        );
        return true;
      } catch (error) {
        if (conditionFailed(error)) return false;
        throw error;
      }
    },

    async get(pk, sk) {
      const out = await client.send(new GetCommand({ TableName: tableName, Key: { pk, sk }, ConsistentRead: true }));
      return (out.Item as Item | undefined) ?? null;
    },

    async delete(pk, sk) {
      await client.send(new DeleteCommand({ TableName: tableName, Key: { pk, sk } }));
    },

    async updateIf(pk, sk, set, when) {
      // Names and values are placeholders (#s0, :s0, #w0, :w0), so any attribute name is safe.
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets = Object.entries(set).map(([k, v], i) => {
        names[`#s${i}`] = k;
        values[`:s${i}`] = v;
        return `#s${i} = :s${i}`;
      });
      const checks = Object.entries(when).map(([k, v], i) => {
        names[`#w${i}`] = k;
        values[`:w${i}`] = v;
        return `#w${i} = :w${i}`;
      });
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk, sk },
            UpdateExpression: `SET ${sets.join(", ")}`,
            ConditionExpression: ["attribute_exists(pk)", ...checks].join(" AND "),
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          }),
        );
        return true;
      } catch (error) {
        if (conditionFailed(error)) return false;
        throw error;
      }
    },

    async query(pk, prefix, after) {
      const items: Item[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const out = await client.send(
          new QueryCommand({
            TableName: tableName,
            // "\u0000" after `after` is the smallest key greater than it; "￿" bounds the prefix.
            KeyConditionExpression: "pk = :pk AND sk BETWEEN :low AND :high",
            ExpressionAttributeValues: { ":pk": pk, ":low": after ? `${after}\u0000` : prefix, ":high": `${prefix}￿` },
            ConsistentRead: true,
            ExclusiveStartKey: start,
          }),
        );
        items.push(...((out.Items as Item[] | undefined) ?? []));
        start = out.LastEvaluatedKey;
      } while (start);
      return items;
    },

    async appendAt(pk, expected, next, items) {
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: { pk, sk: "META" },
                  UpdateExpression: "SET #v = :next",
                  ConditionExpression: "#v = :expected",
                  ExpressionAttributeNames: { "#v": "version" },
                  ExpressionAttributeValues: { ":next": next, ":expected": expected },
                },
              },
              ...items.map((Item) => ({
                Put: { TableName: tableName, Item, ConditionExpression: "attribute_not_exists(pk)" },
              })),
            ],
          }),
        );
        return true;
      } catch (error) {
        if (conditionFailed(error)) return false;
        throw error;
      }
    },
  };
}
