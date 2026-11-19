// Rapier (physics, WASM inlined) + Yuka (game AI steering) exposed as globals for the classic-script game.
import RAPIER from '@dimforge/rapier3d-compat';
import * as YUKA from 'yuka';
window.RAPIER = RAPIER;
window.YUKA = YUKA;
