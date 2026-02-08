/*
Module: VLESS RU Filter Updater
Description: Downloads parent VLESS list, filters RU servers, validates entries, writes cheburnet.txt, logs actions, auto-inits git repo, checks SSH key, commits and pushes changes. Supports single-run and daemon mode with jitter and watchdog.
Run: node update.js [--daemon]
File: update.js
*/

import fs from "fs";
import path from "path";
import https from "https";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// Resolve working directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config
const PARENT_URL = "https://raw.githubusercontent.com/zieng2/wl/main/vless_lite.txt";
const OUTPUT_FILE = path.join(__dirname, "cheburnet.txt");
const LOG_FILE = path.join(__dirname, "update.log");
const AUTO_INIT = true;

// Log function
function log(msg) {
  const timestamp = new Date().toISOString().replace("T", " ").split(".")[0];
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
  console.log(msg);
}

// Download function
function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error("HTTP " + res.statusCode));
          return;
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

// Validate VLESS entry
function isValidVless(line) {
  if (!line.startsWith("vless://")) return false;
  if (!line.includes("@")) return false;
  if (!line.includes("#")) return false;

  const [urlPart] = line.split("#");
  if (urlPart.includes(" ")) return false;

  return true;
}

// Detect RU-tag
function isRussianTagged(line) {
  return (
    line.includes("🇷🇺") ||
    line.includes("%F0%9F%87%B7%F0%9F%87%BA")
  );
}

// Filter only Russian servers + validate
function filterRussian(list) {
  const lines = list.split("\n");

  const filtered = lines
    .map((l) => l.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line.includes("vless://"))
    .filter(isRussianTagged)
    .filter(isValidVless);

  // Remove duplicates
  return Array.from(new Set(filtered)).join("\n");
}

// Write output file
function writeOutput(content) {
  fs.writeFileSync(OUTPUT_FILE, content, "utf8");
}

// Check if file content changed
function hasChanged(newContent) {
  if (!fs.existsSync(OUTPUT_FILE)) return true;
  const old = fs.readFileSync(OUTPUT_FILE, "utf8");
  return old.trim() !== newContent.trim();
}

// Check if inside a git repo
function isGitRepo() {
  return fs.existsSync(path.join(__dirname, ".git"));
}

// Check if git exists
function gitExists() {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Auto-init git repo
function gitInit() {
  if (!AUTO_INIT) return;

  if (!gitExists()) {
    log("Git not found. Cannot auto-init repo.");
    return;
  }

  log("Initializing git repository...");
  execSync("git init", { stdio: "ignore" });
  execSync("git branch -M main", { stdio: "ignore" });
  log("Git repository initialized.");
}

// Check SSH key availability
function sshAvailable() {
  try {
    execSync("ssh -T -o BatchMode=yes git@github.com-jebance", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// Auto-commit
function gitCommit() {
  if (!gitExists()) {
    log("Git not found. Skipping commit.");
    return;
  }

  if (!isGitRepo()) {
    log("Not a git repository.");
    gitInit();
    if (!isGitRepo()) return;
  }

  if (!sshAvailable()) {
    log("SSH key not available. Skipping push.");
    return;
  }

  try {
    const fileName = path.basename(OUTPUT_FILE);
    execSync(`git add ${fileName}`);
    execSync(
      'git commit -m "chore: update cheburnet.txt (RU-only VLESS list sync)"'
    );
    execSync("git push");
    log("Git commit pushed.");
  } catch {
    log("No changes to commit.");
  }
}

// Main logic
async function main() {
  log("Downloading parent list...");

  let raw;
  try {
    raw = await download(PARENT_URL);
    log("Download OK");
  } catch (err) {
    log("Download failed: " + err.message);
    log("Fallback: using previous version");
    return;
  }

  log("Filtering RU servers...");
  const filtered = filterRussian(raw);

  const linesCount =
    filtered.trim().length === 0
      ? 0
      : filtered.split("\n").filter((l) => l.trim().length > 0).length;

  log("Filtered entries: " + linesCount);

  if (linesCount === 0) {
    log("No RU entries found. Exiting.");
    return;
  }

  if (!hasChanged(filtered)) {
    log("No changes detected. Exiting.");
    return;
  }

  log("Writing output file...");
  writeOutput(filtered);

  log("Committing changes...");
  gitCommit();

  log("Done.");
}

// Watchdog wrapper
async function safeMain() {
  return new Promise((resolve) => {
    let finished = false;

    const timeout = setTimeout(() => {
      if (!finished) {
        log("Watchdog: main() timeout, restarting...");
        resolve();
      }
    }, 5 * 60 * 1000); // 5 minutes

    main()
      .catch((err) => log("Fatal error: " + err.message))
      .finally(() => {
        finished = true;
        clearTimeout(timeout);
        resolve();
      });
  });
}

// Daemon mode
async function daemon() {
  while (true) {
    await safeMain();

    const jitter = Math.floor(Math.random() * 10 * 60 * 1000) - 5 * 60 * 1000;
    const sleepTime = 24 * 60 * 60 * 1000 + jitter;

    log("Sleeping for " + Math.round(sleepTime / 60000) + " minutes...");
    await new Promise((resolve) => setTimeout(resolve, sleepTime));
  }
}

// Entry point
const args = process.argv.slice(2);

if (args.includes("--daemon")) {
  log("Starting in daemon mode...");
  daemon();
} else {
  safeMain();
}

