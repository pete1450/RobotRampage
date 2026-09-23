# ROBOT RAMPAGE

An arcade Rampage-style robot city-destruction game in a **single HTML file**
(`index.html`). Three.js r147 is inlined, so the game runs offline with no
build step at runtime — open the file (or the GitHub Pages URL) and smash.

Smash buildings, climb their faces, eat civilians for health, dodge soldiers
and helicopters, grab powerups, and hop out as the pilot for first-person
gun/torch repair action.

## Controls

| Input | Action |
|---|---|
| WASD / arrows | move (left stick on mobile) |
| SPACE / J | punch (PUNCH button on mobile) |
| SHIFT / K | jump |
| push into a building | climb its faces |
| F | disembark / re-embark as the pilot (🚪 / 🤖 buttons on mobile) |
| V | switch pilot gun / repair torch (🔫 / 🔥 on mobile) |
| E | fire a stored energy sphere (⚡ on mobile, max 3 charges) |

## Files

| File | What it is |
|---|---|
| `head.html` | HTML shell: HUD, menus, mobile buttons, CSS |
| `three.min.js` | three.js r147, inlined into the final page |
| `logic.js` | pure game-logic helpers + unit tests live in `test_logic.js` |
| `game.js` | the whole game: world, robot, pilot, enemies, audio, UI |
| `build.py` | assembles the single-file `index.html` |
| `test_logic.js` | unit tests for `logic.js` |
| `test_sim.js` | headless integration test: stubs THREE/DOM and actually plays the game |

## Build & test locally

```bash
node test_logic.js   # unit tests
node test_sim.js     # headless playthrough (climb, smash, pilot mode, ...)
python3 build.py              # writes index.html next to the script
python3 build.py /path/to/index.html  # or pass an output path
```

## CI

`.github/workflows/build.yml` runs on every push to `main`: it runs the node
checks + headless tests, builds the single-file `index.html`, and commits it
to the repo root so GitHub Pages can serve it. The bot's own build commits
carry `[skip ci]` and don't retrigger the workflow.
