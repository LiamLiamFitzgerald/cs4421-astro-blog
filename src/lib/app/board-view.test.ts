import { describe, expect, it } from "vitest";
import { generateBoard } from "../games/catan/board";
import { boardView, hexLabel, pipCount } from "./board-view";

describe("Feature: drawing the board", () => {
  describe("Scenario: pips", () => {
    it.each([
      [2, 1],
      [3, 2],
      [6, 5],
      [7, 6],
      [8, 5],
      [11, 2],
      [12, 1],
      [1, 0],
      [13, 0],
    ])("roll %i has %i pips", (n, pips) => expect(pipCount(n)).toBe(pips));
  });

  describe("Scenario: labels", () => {
    it("names the terrain, resource and number", () => {
      expect(hexLabel({ terrain: "forest", token: 8 })).toBe("Forest, lumber, 8");
    });

    it("names the desert without a resource or number", () => {
      expect(hexLabel({ terrain: "desert", token: null })).toBe("Desert");
    });
  });

  describe("Scenario: layout", () => {
    const view = boardView(generateBoard(5), 50);

    it("draws one hex per board hex", () => {
      expect(view.hexes).toHaveLength(19);
      expect(new Set(view.hexes.map((h) => h.key)).size).toBe(19);
    });

    it("puts the centre hex at the origin", () => {
      const centre = view.hexes.find((h) => h.key === "0,0");
      expect(centre).toMatchObject({ cx: 0, cy: 0 });
    });

    it("spaces neighbours one hex width apart", () => {
      const east = view.hexes.find((h) => h.key === "1,0");
      const south = view.hexes.find((h) => h.key === "0,1");
      expect(east?.cx).toBeCloseTo(50 * Math.sqrt(3), 1);
      expect(east?.cy).toBe(0);
      expect(south?.cy).toBe(75);
    });

    it("gives each hex six corners with the top corner straight above the centre", () => {
      const centre = view.hexes.find((h) => h.key === "0,0");
      const corners = centre?.points.split(" ") ?? [];
      expect(corners).toHaveLength(6);
      expect(corners[0]).toBe("0,-48.5");
    });

    it("marks only 6 and 8 as red, and gives the desert no pips", () => {
      for (const hex of view.hexes) {
        expect(hex.red).toBe(hex.token === 6 || hex.token === 8);
        if (hex.token === null) expect(hex.pips).toBe(0);
      }
    });

    it("keeps every hex inside the view box", () => {
      const [x, y, w, h] = view.viewBox.split(" ").map(Number) as [number, number, number, number];
      for (const hex of view.hexes) {
        expect(hex.cx - 50).toBeGreaterThan(x);
        expect(hex.cx + 50).toBeLessThan(x + w);
        expect(hex.cy - 50).toBeGreaterThan(y);
        expect(hex.cy + 50).toBeLessThan(y + h);
      }
    });

    it("draws a six-sided sea frame", () => {
      expect(view.sea.split(" ")).toHaveLength(6);
    });
  });
});

describe("Feature: placing pieces on the drawing", () => {
  it("draws the centre hex's top corner straight above its centre, one radius up", async () => {
    const { cornerPoint } = await import("./board-view");
    expect(cornerPoint({ x: 0, y: -2 }, 50)).toEqual({ x: 0, y: -50 });
    expect(cornerPoint({ x: 1, y: -1 }, 50)).toEqual({ x: 43.3, y: -25 });
  });
});

describe("Feature: board depth details", () => {
  it("draws a bevel inside each tile and a coast line inside the frame", async () => {
    const { boardView } = await import("./board-view");
    const { generateBoard } = await import("../games/catan/board");
    const view = boardView(generateBoard(1), 50);
    const centre = view.hexes.find((h) => h.key === "0,0");
    expect(centre?.inner.split(" ")[0]).toBe("0,-43");
    expect(view.coast.split(" ")).toHaveLength(6);
    expect(view.coast.split(" ")[0]).toBe("254.5,0");
  });
});
