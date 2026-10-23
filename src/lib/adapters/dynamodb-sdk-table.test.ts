import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { type Sender, sdkTable } from "./dynamodb-sdk-table";

/** Records each command and answers from a queue. */
function client(answers: (unknown | Error)[] = []) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const send = (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    sent.push({ name: command.constructor.name, input: command.input });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next ?? {};
  }) as unknown as Sender["send"];
  return { sender: { send } as Sender, sent };
}
const failure = (name: string) => Object.assign(new Error(name), { name });

describe("Feature: the DynamoDB table calls", () => {
  it("writes an item only if absent", async () => {
    const { sender, sent } = client();
    expect(await sdkTable(sender, "T").putIfAbsent({ pk: "p", sk: "s" })).toBe(true);
    expect(sent[0]).toEqual({
      name: PutCommand.name,
      input: { TableName: "T", Item: { pk: "p", sk: "s" }, ConditionExpression: "attribute_not_exists(pk)" },
    });
  });

  it("reports an existing item as false", async () => {
    const { sender } = client([failure("ConditionalCheckFailedException")]);
    expect(await sdkTable(sender, "T").putIfAbsent({ pk: "p", sk: "s" })).toBe(false);
  });

  it("passes on other errors", async () => {
    const { sender } = client([failure("ProvisionedThroughputExceededException")]);
    await expect(sdkTable(sender, "T").putIfAbsent({ pk: "p", sk: "s" })).rejects.toThrow("ProvisionedThroughput");
  });

  it("gets with a strongly consistent read", async () => {
    const { sender, sent } = client([{ Item: { pk: "p", sk: "s", x: 1 } }, {}]);
    const table = sdkTable(sender, "T");
    expect(await table.get("p", "s")).toEqual({ pk: "p", sk: "s", x: 1 });
    expect(await table.get("p", "missing")).toBeNull();
    expect(sent[0]).toEqual({ name: GetCommand.name, input: { TableName: "T", Key: { pk: "p", sk: "s" }, ConsistentRead: true } });
  });

  it("queries a prefix, following pages until the end", async () => {
    const { sender, sent } = client([
      { Items: [{ pk: "p", sk: "EVT#1" }], LastEvaluatedKey: { pk: "p", sk: "EVT#1" } },
      { Items: [{ pk: "p", sk: "EVT#2" }] },
    ]);
    expect(await sdkTable(sender, "T").query("p", "EVT#")).toEqual([
      { pk: "p", sk: "EVT#1" },
      { pk: "p", sk: "EVT#2" },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.input).toMatchObject({
      KeyConditionExpression: "pk = :pk AND sk BETWEEN :low AND :high",
      ExpressionAttributeValues: { ":pk": "p", ":low": "EVT#", ":high": "EVT#￿" },
      ConsistentRead: true,
    });
    expect(sent[1]?.input["ExclusiveStartKey"]).toEqual({ pk: "p", sk: "EVT#1" });
  });

  it("queries only keys after a given one", async () => {
    const { sender, sent } = client([{ Items: [] }]);
    await sdkTable(sender, "T").query("p", "EVT#", "EVT#000003");
    expect(sent[0]?.input["ExpressionAttributeValues"]).toMatchObject({ ":low": "EVT#000003\u0000" });
  });

  it("appends in one transaction conditional on the version", async () => {
    const { sender, sent } = client();
    expect(await sdkTable(sender, "T").appendAt("p", 2, 3, [{ pk: "p", sk: "EVT#000003", event: {} }])).toBe(true);
    expect(sent[0]?.name).toBe(TransactWriteCommand.name);
    const items = sent[0]?.input["TransactItems"] as Record<string, Record<string, unknown>>[];
    expect(items[0]?.["Update"]).toMatchObject({
      Key: { pk: "p", sk: "META" },
      ConditionExpression: "#v = :expected",
      ExpressionAttributeValues: { ":next": 3, ":expected": 2 },
    });
    expect(items[1]?.["Put"]).toMatchObject({ Item: { pk: "p", sk: "EVT#000003", event: {} }, ConditionExpression: "attribute_not_exists(pk)" });
  });

  it("reports a lost race as false", async () => {
    const { sender } = client([failure("TransactionCanceledException")]);
    expect(await sdkTable(sender, "T").appendAt("p", 0, 1, [])).toBe(false);
  });

  it("passes on other append errors", async () => {
    const { sender } = client([failure("InternalServerError")]);
    await expect(sdkTable(sender, "T").appendAt("p", 0, 1, [])).rejects.toThrow("InternalServerError");
  });
});
