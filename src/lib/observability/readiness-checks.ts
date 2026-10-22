import { generateBoard } from "../games/catan/board";
import type { ReadinessCheck } from "./readiness";

/** The checks the running server performs. */
export const serverChecks: readonly ReadinessCheck[] = [
  {
    // The game rules module loaded and can deal a valid board.
    name: "rules-engine",
    run: () => generateBoard(1).hexes.length === 19,
  },
];
