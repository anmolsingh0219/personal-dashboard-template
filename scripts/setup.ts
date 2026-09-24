// One-time local setup. Safe to re-run: it only fills in what's missing.
//
//   npm run setup                                              # keys + local database
//   npm run setup -- --url https://dashboard.you.workers.dev    # also sets the push contact URL
//
// - creates .dev.vars from .dev.vars.example
// - generates TOKEN_KEY (encrypts Google tokens at rest) if empty
// - generates the Web Push (VAPID) key pair: public key into wrangler.jsonc, private key into .dev.vars
// - applies the database migrations to the local dev database

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { root } from "./d1.ts";

const devVars = resolve(root, ".dev.vars");
const wranglerPath = resolve(root, "wrangler.jsonc");
const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
const done: string[] = [];

function getVar(text: string, name: string) {
  return text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim() ?? "";
}
function setVar(text: string, name: string, value: string) {
  const line = new RegExp(`^${name}=.*$`, "m");
  return line.test(text) ? text.replace(line, `${name}=${value}`) : `${text.trimEnd()}\n${name}=${value}\n`;
}
function getJsonc(text: string, name: string) {
  return text.match(new RegExp(`"${name}":\\s*"([^"]*)"`))?.[1] ?? "";
}
function setJsonc(text: string, name: string, value: string) {
  return text.replace(new RegExp(`("${name}":\\s*)"[^"]*"`), `$1${JSON.stringify(value)}`);
}

if (!existsSync(devVars)) {
  copyFileSync(resolve(root, ".dev.vars.example"), devVars);
  done.push("created .dev.vars");
}
let vars = readFileSync(devVars, "utf8");
let wrangler = readFileSync(wranglerPath, "utf8");

if (!getVar(vars, "TOKEN_KEY")) {
  vars = setVar(vars, "TOKEN_KEY", Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"));
  done.push("generated TOKEN_KEY");
}

const havePublic = Boolean(getJsonc(wrangler, "VAPID_PUBLIC_KEY"));
const havePrivate = Boolean(getVar(vars, "VAPID_PRIVATE_KEY"));
if (!havePublic && !havePrivate) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as { publicKey: CryptoKey; privateKey: CryptoKey };
  const publicKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  wrangler = setJsonc(wrangler, "VAPID_PUBLIC_KEY", publicKey);
  vars = setVar(vars, "VAPID_PRIVATE_KEY", d!);
  done.push("generated the push notification (VAPID) keys");
} else if (havePublic !== havePrivate) {
  console.warn(
    "! Only half of the VAPID key pair is set (VAPID_PUBLIC_KEY in wrangler.jsonc / VAPID_PRIVATE_KEY in .dev.vars). Clear both and re-run to generate a new pair.",
  );
}

const urlArg = process.argv.indexOf("--url");
if (urlArg > 0) {
  const url = new URL(process.argv[urlArg + 1] ?? "");
  if (url.protocol !== "https:") throw new Error("--url must be your dashboard's https:// address");
  wrangler = setJsonc(wrangler, "VAPID_SUBJECT", url.origin);
  done.push(`set VAPID_SUBJECT to ${url.origin}`);
}

writeFileSync(devVars, vars);
writeFileSync(wranglerPath, wrangler);

execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "dashboard", "--local"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
done.push("applied migrations to the local database");

console.log(done.map((d) => `✓ ${d}`).join("\n"));
console.log("\nNext: npm run dev, then open http://localhost:5173");
