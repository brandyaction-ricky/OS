/**
 * 나눠 그리기 (대표 2026-11-25 「새 영상 먼저, 쉬는 컴퓨터는 거들기」): one longform's full video drawn by this render PC and the
 * other render PCs that are idle right now, over the office network (SSH + rsync, nothing through the OS).
 *
 * MYIN_HELPERS="host:procs,host:procs" names the other PCs (SSH targets this PC can reach without a password). Each helper runs
 * ~/render/myin_help_pieces.sh (every worker installs its own copy at start). A helper takes part only when it is idle and has the
 * same Python · Pillow · numpy · ffmpeg as this PC; it gets an rsync copy of this video's folder plus this PC's diagrams and fonts,
 * draws the 5-second pieces it is handed and this PC fetches each one back. Whatever is missing at the end — a helper that went
 * busy or away — this PC draws in its normal render (MYIN_REUSE_PIECES). With no idle helper nothing changes.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
import os from "node:os";
// The render PCs' own key (render/fleet, 2026-11-08: account Basic, same folders on every PC); MYIN_HELPER_KEY names another.
const KEY = process.env.MYIN_HELPER_KEY || path.join(os.homedir(), ".ssh", "id_ed25519_fleet");
const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "ServerAliveInterval=15", ...(existsSync(KEY) ? ["-i", KEY] : [])];
/** What the engine reads from the environment that is not a path on this PC: passed to the helpers as KEY=VAL. */
const ENGINE_KEYS = /^(STORY|SRC|NO_HOLD|HOLD_[A-Z_]+|SUB_[A-Z_]+|MYIN_(FINAL_FPS|CHAPTER_SEC|LOGO)|VOICE_REF)$/;
/** The video folder minus what pieces never read: earlier outputs, voice takes, caches, and the music · ambience · effect libraries
 * (pieces are silent video; only the mix after them reads those — about half of each copy, 2026-11-28 test: 273 of 540 MB). */
const EXCLUDE = ["voice/os_myin/chunks/", "voice/os_myin/v0/", "voice/os_myin/*.mp4", "voice/os_myin/handouts/", "voice/os_myin/voice16k.wav",
  "voice/os_myin/preview_*.png", "voice/os_voice/p*_s*_*.wav", "voice/os_voice/*_raw.wav", "__pycache__/", "*.bak*", "tools/editor/",
  "/assets/bgm/", "/assets/amb/", "/assets/sfx/"];

// "local" is this PC itself without SSH (a test of the whole hand-out on one computer): same script, folders under this home.
const shell = (host, command) => host === "local" ? ["zsh", ["-c", command]] : ["ssh", [...SSH, host, command]];
const target = (host, rel) => host === "local" ? path.join(os.homedir(), rel) : `${host}:${rel}`;
const rsyncShell = (host) => host === "local" ? [] : ["-e", `ssh ${SSH.join(" ")}`];
export function parseHelpers(value = "") {
  return value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const at = item.lastIndexOf(":"), procs = at > 0 ? Number(item.slice(at + 1)) : NaN;
    return Number.isInteger(procs) && procs > 0 ? { host: item.slice(0, at), procs: Math.min(procs, 16) } : { host: item, procs: 4 };
  });
}
export const pieceFile = (chunks, i) => path.join(chunks, `c${String(i).padStart(2, "0")}.mp4`);
/** Same check as the helper script prints: Python, Pillow, numpy, ffmpeg. Pieces from another setup could differ or not join. */
export async function localFingerprint(python) {
  const [{ stdout: py }, { stdout: ff }] = await Promise.all([
    run(python, ["-c", "import sys, PIL, numpy; print(sys.version.split()[0], PIL.__version__, numpy.__version__)"]),
    run("ffmpeg", ["-version"])]);
  return `${py.trim()} ${ff.split("\n")[0].split(" ")[2]}`;
}
const lines = (stream, onLine) => { let rest = ""; stream.setEncoding("utf8"); stream.on("data", (chunk) => { rest += chunk; const parts = rest.split("\n"); rest = parts.pop(); parts.forEach(onLine); }); };

/**
 * Draws the pieces with the idle helpers; returns { used, pieces, by, seconds }. `used` false means the caller renders as before.
 * A helper is dropped (its pieces go back to the queue) when its connection ends, it reports another piece count, or a fetch fails.
 */
export async function splitPieces({ runId, work, myinDir, env, python, procs, helpers, log = console.log }) {
  if (!helpers.length) return { used: false };
  const fingerprint = await localFingerprint(python).catch(() => "");
  const probed = await Promise.all(helpers.map(async (h) => {
    try {
      const { stdout } = await run(...shell(h.host, "~/render/myin_help_pieces.sh --probe"), { timeout: 30_000 });
      const [state, ...rest] = stdout.trim().split(" ");
      if (state !== "idle") return log(`split: ${h.host} is busy`), null;
      if (rest.join(" ") !== fingerprint) return log(`split: ${h.host} has another setup (${rest.join(" ")} ≠ ${fingerprint})`), null;
      return h;
    } catch (error) { log(`split: ${h.host} unreachable (${error.message.split("\n")[0]})`); return null; }
  }));
  const ready = probed.filter(Boolean);
  if (!ready.length) return { used: false };
  const started = Date.now();
  const chunks = path.join(work, "voice", "os_myin", "chunks");
  mkdirSync(chunks, { recursive: true });
  for (const name of readdirSync(chunks)) if (name.endsWith(".mp4")) rmSync(path.join(chunks, name), { force: true });
  // The video's folder and this PC's diagrams and fonts, so every helper draws with exactly what this PC has. Without MYIN_FONT_DIR
  // the engine draws with the package's assets/fonts (myin_engine.py UF), and the helper script always points at _shared/fonts:
  // send that folder then (2026-11-28 four-PC test: every helper stopped with "cannot open resource" and this PC drew all 109 pieces).
  const fonts = env.MYIN_FONT_DIR || path.join(myinDir, "..", "..", "assets", "fonts");
  const shared = [[env.MYIN_DIAGRAM_DIR, "diagrams"], [String(env.PYTHONPATH ?? "").split(path.delimiter).find((p) => p && p !== env.MYIN_DIAGRAM_DIR), "diagrams-base"],
    [fonts, "fonts"], [env.WIN_FONT_DIR, "winfonts"]].filter(([dir]) => dir && existsSync(dir));
  const synced = await Promise.all(ready.map(async (h) => {
    try {
      await run(...shell(h.host, `mkdir -p ~/myin/help/_shared ~/myin/help/${runId} && find ~/myin/help -mindepth 1 -maxdepth 1 -type d ! -name _shared -mtime +3 -exec rm -rf {} +`), { timeout: 60_000 });
      for (const [dir, name] of shared) await run("rsync", ["-a", "--delete", ...rsyncShell(h.host), `${dir}/`, target(h.host, `myin/help/_shared/${name}/`)], { timeout: 600_000 });
      await run("rsync", ["-a", "--delete", ...EXCLUDE.flatMap((x) => ["--exclude", x]), ...rsyncShell(h.host), `${work}/`, target(h.host, `myin/help/${runId}/`)], { timeout: 900_000 });
      return h;
    } catch (error) { log(`split: copying to ${h.host} failed (${error.message.split("\n")[0]})`); return null; }
  }));
  const helping = synced.filter(Boolean);
  if (!helping.length) return { used: false };

  const keys = Object.entries(env).filter(([k, v]) => ENGINE_KEYS.test(k) && v !== undefined && !String(v).includes(" ")).map(([k, v]) => `${k}=${v}`);
  const workers = [{ name: "here", procs, child: spawn(python, ["render_myin.py", "os_myin", "pieces", String(procs)], { cwd: myinDir, env, stdio: ["pipe", "pipe", "inherit"] }) },
    ...helping.map((h) => ({ name: h.host, procs: h.procs, remote: h.host,
      child: spawn(...shell(h.host, `~/render/myin_help_pieces.sh ${runId} ${h.procs} ${keys.join(" ")}`), { stdio: ["pipe", "pipe", "inherit"] }) }))];
  let total = null;
  const queue = [], done = new Set(), by = {};
  return await new Promise((resolve) => {
    let open = workers.length;
    const give = (w) => {
      if (!w.alive || total === null || w.total === undefined) return;
      while (w.busy.size < w.procs) {
        // the queue first; when it is empty this PC also takes a piece still out with a helper (first one back wins)
        let i = queue.shift();
        if (i === undefined && !w.remote) i = workers.filter((x) => x.remote).flatMap((x) => [...x.busy]).find((p) => !done.has(p) && !w.busy.has(p));
        if (i === undefined) break;
        w.busy.add(i); w.child.stdin.write(`${i}\n`);
      }
      if (done.size === total) for (const x of workers) if (x.alive) x.child.stdin.end();
    };
    const finish = (w) => {
      if (w.alive) { w.alive = false; open -= 1; }
      // this PC's own drawing ended before it counted the pieces: nothing to hand out, let the helpers go
      if (!w.remote && total === null) for (const x of workers) if (x.alive) x.child.kill();
      for (const i of w.busy) if (!done.has(i) && !queue.includes(i)) queue.unshift(i);
      w.busy.clear();
      for (const x of workers) give(x);
      if (!open || (total !== null && done.size === total && workers.every((x) => !x.alive || !x.busy.size)))
        resolve({ used: true, pieces: total ?? 0, done: done.size, by, seconds: Math.round((Date.now() - started) / 1000) });
    };
    for (const w of workers) {
      w.alive = true; w.busy = new Set();
      w.child.on("error", () => finish(w));
      w.child.on("exit", () => finish(w));
      w.child.stdin.on("error", () => {});
      lines(w.child.stdout, async (line) => {
        const [word, a, b] = line.trim().split(" ");
        if (word === "ready") {
          const count = Number(a);
          if (total === null && !w.remote) { total = count; queue.push(...Array.from({ length: count }, (_, i) => i)); log(`split: ${count} pieces (${b} frames) · here ${procs} + ${helping.map((h) => `${h.host} ${h.procs}`).join(" + ")}`); }
          if (total !== null && count !== total) { log(`split: ${w.name} counts ${count} pieces, here ${total} — dropped`); w.child.kill(); return; }
          w.total = count;
          for (const x of workers) give(x);
        } else if (word === "done") {
          const i = Number(a);
          if (w.remote && !done.has(i)) {
            try { await run("rsync", ["-a", ...rsyncShell(w.remote), target(w.remote, path.posix.join("myin/help", runId, "voice/os_myin/chunks", path.basename(pieceFile("", i)))), `${chunks}/`], { timeout: 120_000 }); }
            catch (error) { log(`split: fetching piece ${i} from ${w.name} failed — dropped`); w.child.kill(); return; }
          }
          w.busy.delete(i);
          if (!done.has(i) && existsSync(pieceFile(chunks, i)) && statSync(pieceFile(chunks, i)).size > 0) { done.add(i); by[w.name] = (by[w.name] ?? 0) + 1; }
          give(w);
          if (total !== null && done.size === total && workers.every((x) => !x.alive || !x.busy.size)) for (const x of workers) if (x.alive) x.child.stdin.end();
        }
      });
    }
  });
}
