import { describeEventStoreContract } from "../app/event-store-contract";
import { MemoryEventStore } from "./memory-event-store";

describeEventStoreContract("MemoryEventStore", () => new MemoryEventStore());
