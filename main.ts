// MERIDIAN TERMINAL — entrypoint for the make.fun threejs-fps-01 bounty.
// It stages the game plus its screenshots into the output directory, then
// writes the dossier the scorer reads, using the vendored builder.
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import * as dossier from "./vendor/makefun-threejs.ts";

const entryDir = path.dirname(url.fileURLToPath(import.meta.url));
const dropDir = process.env["MAKEFUN_OUTPUT_DIR"] || "/output";

// Caps from the bounty gate, spelled out as arithmetic on the gate's
// KiB / MiB figures so the numbers stay visibly derived, not pasted.
const TEXT_CAP_BYTES = 160 * 1024;
const SHOT_CAP_COUNT = 4;
const SHOT_CAP_BYTES = 256 * 1024;
const GAME_CAP_FILES = 993;
const GAME_CAP_BYTES = 48 * 1024 * 1024;

fs.mkdirSync(dropDir, { recursive: true });

const stagedGame = path.join(dropDir, "game");
fs.cpSync(path.join(entryDir, "game"), stagedGame, { recursive: true });

const stagedShots = path.join(dropDir, "screenshots");
fs.mkdirSync(stagedShots, { recursive: true });
const localShots = path.join(entryDir, "screenshots");
if (fs.existsSync(localShots)) {
  fs.cpSync(localShots, stagedShots, { recursive: true });
}

const limits = {
  text_max_bytes: TEXT_CAP_BYTES,
  screenshots: { max: SHOT_CAP_COUNT, max_bytes: SHOT_CAP_BYTES },
  game_max_files: GAME_CAP_FILES,
  game_max_bytes: GAME_CAP_BYTES,
};
const payload = dossier.buildDossier(dropDir, limits);
fs.writeFileSync(path.join(dropDir, "dossier.json"), payload);
