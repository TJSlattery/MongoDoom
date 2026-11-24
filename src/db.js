// MongoDB connection helpers shared by seed, server and tests.
import { MongoClient } from "mongodb";

export const DEFAULT_URI = "mongodb://127.0.0.1:27017/mongodoom";

export async function connect(uri = process.env.MONGODB_URI || DEFAULT_URI) {
  const client = new MongoClient(uri);
  await client.connect();
  return { client, db: client.db() };
}

/** Restore games/_id:"doom" from the template written by seed.js (a document copy, no game logic). */
export async function resetGame(db) {
  const t = await db.collection("templates").findOne({ _id: "doom_initial" });
  if (!t) throw new Error("No template found; run `npm run seed` first");
  await db.collection("games").replaceOne({ _id: "doom" }, { _id: "doom", ...t.state }, { upsert: true });
}
