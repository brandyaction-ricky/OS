// 내 컴퓨터 렌더 (owner decisions 2026-10-27): on a staff PC (Mac or Windows), install the render PC's current v13 engine from the OS
// and run the worker for the ③ drafts its owner sends to this computer. When the render PC moves to a new engine, the worker stops
// between jobs and this installs the new one by itself.
//   node myin-local.mjs <키>   first time (the OS 「내 컴퓨터 연결」 command does this), then just: node myin-local.mjs
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OS_URL = (process.env.OS_URL || "https://brandyaction-os.vercel.app").replace(/\/$/, "");
const windows = process.platform === "win32";
export const homeDir = () => process.env.MYIN_LOCAL_HOME
  || (windows ? path.join(process.env.LOCALAPPDATA || os.homedir(), "myin-local") : path.join(os.homedir(), "myin-local"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(key, body) {
  const response = await fetch(`${OS_URL}/api/v1/content/youtube-automation/local-render`, {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(json.error?.message ?? `OS ${response.status}`), { code: json.error?.code });
  return json;
}

// The key stays in this user's own folder, readable only by them.
export function saveKey(home, key) { mkdirSync(home, { recursive: true }); writeFileSync(path.join(home, "key"), key, { mode: 0o600 }); }
const readKey = (home) => { try { return readFileSync(path.join(home, "key"), "utf8").trim(); } catch { return ""; } };

/** The Python the engine was built with (MYIN_LOCAL_PYTHON for tests); installed with Homebrew or winget when missing. */
const python = (version) => process.env.MYIN_LOCAL_PYTHON ? [process.env.MYIN_LOCAL_PYTHON, []] : windows ? ["py", [`-${version}`]] : [`python${version}`, []];
const hasPython = (version) => { const [command, pre] = python(version); return spawnSync(command, [...pre, "-c", "print(1)"]).status === 0; };
function ensurePython(version) {
  if (hasPython(version)) return;
  console.log(`파이썬 ${version}을 설치해요…`);
  if (windows) spawnSync("winget", ["install", "-e", "--id", `Python.Python.${version}`, "--accept-package-agreements", "--accept-source-agreements"], { stdio: "inherit" });
  else spawnSync("brew", ["install", `python@${version}`], { stdio: "inherit" });
  if (!hasPython(version)) throw new Error(`파이썬 ${version}을 설치하지 못했어요. 설치한 뒤 다시 실행해 주세요.`);
}
const chrome = () => (windows
  ? [path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
     path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
     path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")]
  : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]).find((file) => existsSync(file));
const venvPython = (venv) => windows ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");

// A Mac's tar stores Korean names decomposed (NFD) while the render PC's files are NFC: Windows would not find 톤앤매너.json by
// the name in the code, and names read from folders would differ. Back to NFC, as on the render PC (through a temporary name,
// since a Mac treats both spellings as the same file).
export function nfcNames(dir) {
  for (const name of readdirSync(dir)) {
    let full = path.join(dir, name);
    const nfc = name.normalize("NFC");
    if (nfc !== name) { renameSync(full, `${full}.nfc`); renameSync(`${full}.nfc`, full = path.join(dir, nfc)); }
    if (lstatSync(full).isDirectory()) nfcNames(full);
  }
}

/**
 * The render PC's bundle as this PC's engine folder: every part checked against its hash, unpacked, and a Python environment with
 * exactly the render PC's packages. Returns the folder and its Python. An engine already installed is used as it is.
 */
export async function installEngine(info, home) {
  const dir = path.join(home, `engine-${info.fingerprint}`);
  const lock = path.join(dir, "requirements.lock");
  if (!existsSync(path.join(dir, ".ready"))) {
    console.log(`영상 만드는 컴퓨터의 엔진을 받는 중이에요 (${info.parts.length}개 묶음)…`);
    const tmp = mkdtempSync(path.join(os.tmpdir(), "myin-engine-")), bundle = path.join(tmp, "bundle.tar.gz"), partial = `${dir}.partial`;
    try {
      writeFileSync(bundle, "");
      for (const [n, part] of info.parts.entries()) {
        const response = await fetch(part.url);
        if (!response.ok) throw new Error(`엔진 묶음 ${n + 1}을 받지 못했어요 (${response.status}).`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== part.bytes || createHash("sha256").update(bytes).digest("hex") !== part.sha256) throw new Error(`엔진 묶음 ${n + 1}이 손상됐어요. 다시 실행해 주세요.`);
        appendFileSync(bundle, bytes);
      }
      rmSync(partial, { recursive: true, force: true }); mkdirSync(partial, { recursive: true });
      // macOS and Windows 10+ both ship tar with gzip.
      if (spawnSync("tar", ["-xzf", bundle, "-C", partial], { stdio: "inherit" }).status !== 0) throw new Error("엔진 묶음을 풀지 못했어요.");
      nfcNames(partial);
      if (readFileSync(path.join(partial, "FINGERPRINT"), "utf8").trim() !== info.fingerprint) throw new Error("받은 엔진이 영상 만드는 컴퓨터 것과 달라요.");
      rmSync(dir, { recursive: true, force: true }); renameSync(partial, dir);
    } finally { rmSync(tmp, { recursive: true, force: true }); rmSync(partial, { recursive: true, force: true }); }
  }
  // One environment per package list, shared by engines with the same list.
  const lockId = createHash("sha256").update(readFileSync(lock)).digest("hex").slice(0, 12);
  const venv = path.join(home, `venv-${info.python}-${lockId}`);
  if (!existsSync(path.join(venv, ".ready"))) {
    console.log("엔진에 필요한 파이썬 패키지를 설치하는 중이에요…");
    ensurePython(info.python);
    const [command, pre] = python(info.python);
    rmSync(venv, { recursive: true, force: true });
    const steps = [[command, [...pre, "-m", "venv", venv]]];
    if (readFileSync(lock, "utf8").trim()) steps.push([venvPython(venv), ["-m", "pip", "install", "--quiet", "-r", lock]]);
    for (const [cmd, args] of steps) if (spawnSync(cmd, args, { stdio: "inherit" }).status !== 0) throw new Error("파이썬 패키지를 설치하지 못했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.");
    writeFileSync(path.join(venv, ".ready"), info.fingerprint);
  }
  writeFileSync(path.join(dir, ".ready"), info.fingerprint);
  // Keep this engine and the one before it; older ones only take disk.
  const older = readdirSync(home).filter((name) => /^engine-[a-f0-9]{32}$/.test(name) && name !== path.basename(dir))
    .map((name) => ({ name, at: statSync(path.join(home, name)).mtimeMs })).sort((a, b) => b.at - a.at);
  for (const old of older.slice(1)) rmSync(path.join(home, old.name), { recursive: true, force: true });
  return { dir, python: venvPython(venv) };
}

/** The worker's settings for an installed engine: only the folders the bundle has, as on the render PC. */
export function workerEnv(engine, home, key) {
  const part = (name) => existsSync(path.join(engine.dir, "engine", name)) ? path.join(engine.dir, "engine", name) : undefined;
  const env = { ...process.env, OS_URL, MYIN_LOCAL_KEY: key, MYIN_PKG: part("pkg"), MYIN_DIAGRAM_DIR: part("diagrams"), MYIN_FONT_DIR: part("fonts"),
    MYIN_LIBRARY: part("library") ?? path.join(home, "no-library"), MYIN_PYTHON: engine.python, MYIN_WORK: path.join(home, "work"), CHROME_PATH: chrome() };
  for (const name of Object.keys(env)) if (env[name] === undefined) delete env[name];
  return env;
}

// The computer stays awake while this runs (a closed lid or sleep would stop a draft halfway).
function keepAwake() {
  if (!windows) return spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
  const script = "$t=Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint e);' -Name P -Namespace W -PassThru; while($true){ $t::SetThreadExecutionState(0x80000001) | Out-Null; Start-Sleep 50 }";
  return spawn("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore" });
}

async function main() {
  const home = homeDir(), given = process.argv[2];
  if (given) { if (!given.startsWith("bos_pat_")) throw new Error("OS의 「내 컴퓨터 연결」에서 만든 명령을 그대로 붙여 넣어 주세요."); saveKey(home, given); }
  const key = readKey(home);
  if (!key) throw new Error("연결 키가 없어요. OS의 「내 컴퓨터 연결」에서 명령을 만들어 붙여 넣어 주세요.");
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("ffmpeg가 필요해요. 설치 명령을 다시 붙여 넣어 주세요.");
  if (!chrome()) throw new Error("Google Chrome이 필요해요(사이트 화면 캡처에 써요). 설치한 뒤 다시 실행해 주세요.");
  mkdirSync(path.join(home, "work"), { recursive: true });
  const awake = keepAwake();
  process.on("exit", () => awake.kill());
  console.log("내 컴퓨터 영상 만들기를 켰어요. 이 창을 열어 두면 OS에서 「내 컴퓨터」로 고른 미리보기 영상을 만들어요. 끝내려면 Ctrl+C.");
  for (;;) {
    let info;
    try { info = await api(key, { action: "engine" }); }
    catch (error) { console.error(`OS에 연결하지 못했어요: ${error.message} · 1분 뒤 다시 해요.`); await sleep(60_000); continue; }
    if (!info.available) { console.log("영상 만드는 컴퓨터가 새 엔진 묶음을 준비하는 중이에요. 5분 뒤 다시 확인해요."); await sleep(5 * 60_000); continue; }
    const engine = await installEngine(info, home);
    console.log(`엔진 ${info.fingerprint.slice(0, 8)} · 미리보기 영상을 기다리는 중`);
    const code = await new Promise((resolve) => {
      const worker = spawn(process.execPath, [path.join(engine.dir, "tools", "youtube-media-worker.mjs"), "--local"], { stdio: "inherit", env: workerEnv(engine, home, key) });
      worker.on("exit", (exitCode) => resolve(exitCode));
    });
    // 3: the render PC moved to a new engine; install it and start again. Anything else: wait a minute and start again.
    if (code !== 3) { console.error(`영상 프로그램이 멈췄어요 (코드 ${code}). 1분 뒤 다시 시작해요.`); await sleep(60_000); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exit(1); });
