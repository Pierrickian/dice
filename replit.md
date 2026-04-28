# WebGL 3D Dice Game

A browser-based 3D dice rolling game built with Three.js and Cannon-es physics.

## Tech Stack

- **Frontend**: Vanilla JavaScript with Three.js (3D rendering) and Cannon-es (physics)
- **Build Tool**: Vite
- **Package Manager**: npm

## Project Structure

- `index.html` — App entry point
- `src/main.js` — Main game logic (scene, physics, UI)
- `src/rules.json` — Game rules configuration (single source of truth for all game mechanics)
- `src/style.css` — UI styles
- `public/` — Static assets

## Development

```bash
npm run dev   # Start dev server on port 5000
npm run build # Build for production
```

## Deployment

Configured as a static site deployment:
- Build command: `npm run build`
- Public directory: `dist`

## Features

- Roll 4, 6, 8, 10, 12, or 20-sided dice
- Physics-based dice rolling with Three.js + Cannon-es
- Up to 3 rolls per turn
- Score tracking

---

## AGENT INSTRUCTIONS — Game Rule Modifications

**Every game rule change must go through `src/rules.json`. Never hardcode game logic directly in `src/main.js`.**

### Architecture

`src/rules.json` is the single source of truth for all game mechanics. It has two layers per rule:
- A **human-readable layer** (`description`, `example`) for non-programmers to understand and edit.
- A **machine-readable layer** (`engine` block) that `src/main.js` interprets at runtime.

`src/main.js` contains a rules interpreter at the top of the file. It reads the JSON and dispatches to a small set of handler functions. The game engine never contains hardcoded rule values.

### What lives in rules.json

| Mechanic | JSON path |
|---|---|
| Max rolls per round | `game.round_structure.max_rolls_per_round` |
| Unlock all dice on final roll | `game.round_structure.unlock_all_on_final_roll` |
| Dice count options & default | `game.configuration.dice_count` |
| Dice faces options & default | `game.configuration.dice_faces` |
| Banking eligibility conditions | `game.banking_rules.conditions[]` |
| Points per banked die | `game.scoring.per_die_banked.points` |
| Early finish bonuses | `game.scoring.early_finish_bonus.bonuses[]` |
| Score reset threshold | `game.scoring.score_reset.threshold` |

### How banking conditions work

Each condition in `game.banking_rules.conditions[]` has an `engine` block with a `type` and parameters. The interpreter in `main.js` maps each type to a pure function:

| `engine.type` | Parameters | Effect |
|---|---|---|
| `highest_value` | — | All dice showing the maximum rolled value are eligible |
| `n_of_a_kind` | `min_count`, `eligible_count` | Groups of `min_count`+ identical values; `eligible_count` = `1` or `"all"` |
| `pair_sum` | `target_sum`, `eligible_count` | Pairs of dice summing to `target_sum`; `eligible_count` from first pair |
| `straight` | `run_length`, `eligible_count` | Run of `run_length` consecutive unique values; `eligible_count` from first run |

### How to modify a rule (examples)

**Change max rolls from 3 to 4:**
```json
"max_rolls_per_round": 4
```
Update `bonuses[]` accordingly (now 3 early rolls possible instead of 2).

**Change score reset threshold from 50 to 100:**
```json
"score_reset": { "threshold": 100 }
```

**Add a new banking condition (e.g. any die showing a 1 is always keepable):**
1. Add entry to `game.banking_rules.conditions[]` with a new `engine.type` (e.g. `exact_value`).
2. Add the corresponding handler function to `conditionHandlers` in `src/main.js`.
3. Keep the `description` and `example` fields human-readable.

**Modify early finish bonus:**
```json
"bonuses": [
  { "rolls_used": 1, "bonus_points": 3 },
  { "rolls_used": 2, "bonus_points": 1 },
  { "rolls_used": 3, "bonus_points": 0 }
]
```

### What must NOT be done

- Do not hardcode `maxRolls = 3`, score thresholds, or banking logic directly in `main.js`.
- Do not add a new condition type only in `main.js` without a corresponding entry in `rules.json`.
- Do not change game behaviour by editing only one of the two files — both must stay in sync.
- The `description` fields in `rules.json` are for humans; do not rely on them for logic. Only the `engine` block drives behaviour.
