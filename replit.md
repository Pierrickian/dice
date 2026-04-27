# WebGL 3D Dice Game

A browser-based 3D dice rolling game built with Three.js and Cannon-es physics.

## Tech Stack

- **Frontend**: Vanilla JavaScript with Three.js (3D rendering) and Cannon-es (physics)
- **Build Tool**: Vite
- **Package Manager**: npm

## Project Structure

- `index.html` — App entry point
- `src/main.js` — Main game logic (scene, physics, UI)
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
