import console from "node:console";
import { createHash, randomBytes } from "node:crypto";
import process from "node:process";

if (!process.stdout.isTTY) {
  console.error("Run this script in a private terminal to generate your admin password.");
  process.exitCode = 1;
} else {
  const password = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(password, "utf8").digest("hex");

  console.log("Save this admin password in your password manager:");
  console.log(password);
  console.log("\nSet this verifier as a secret on the Cloudflare Worker:");
  console.log(`ADMIN_PASSWORD_HASH=sha256$${hash}`);
  console.log("Keep both values out of chat, screenshots, logs, and repository files.");
}
