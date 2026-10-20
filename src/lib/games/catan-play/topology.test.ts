import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BOARD_POSITIONS } from "../catan/board";
import { buildTopology, edgeBetween, TOPOLOGY } from "./topology";

const { vertices, edges, hexCorners } = TOPOLOGY;
const vertexId = fc.integer({ min: 0, max: vertices.length - 1 });

describe("Feature: corners and edges of the base board", () => {
  describe("Scenario: counts", () => {
    it("has 54 corners and 72 edges", () => {
      expect(vertices).toHaveLength(54);
      expect(edges).toHaveLength(72);
    });

    it("numbers corners and edges 0..n-1 in order", () => {
      expect(vertices.map((v) => v.id)).toEqual([...Array(54).keys()]);
      expect(edges.map((e) => e.id)).toEqual([...Array(72).keys()]);
    });

    it("gives every hex six distinct corners", () => {
      expect(Object.keys(hexCorners)).toHaveLength(19);
      for (const corners of Object.values(hexCorners)) {
        expect(new Set(corners).size).toBe(6);
      }
    });

    it("has 18 coastal corners touching one hex, and the rest touching 2 or 3", () => {
      const byCount = (n: number) => vertices.filter((v) => v.hexes.length === n).length;
      expect(byCount(1)).toBe(18);
      expect(byCount(2)).toBe(12);
      expect(byCount(3)).toBe(24);
    });
  });

  describe("Scenario: the centre hex", () => {
    it("shares each of its corners with three hexes", () => {
      for (const v of hexCorners["0,0"] ?? []) {
        expect(vertices[v]?.hexes).toHaveLength(3);
        expect(vertices[v]?.hexes).toContain("0,0");
      }
    });

    it("lists its corners clockwise from the top", () => {
      const [top, upperRight, lowerRight, bottom, lowerLeft, upperLeft] = (hexCorners["0,0"] ?? []).map(
        (v) => vertices[v],
      );
      expect(top).toMatchObject({ x: 0, y: -2 });
      expect(upperRight).toMatchObject({ x: 1, y: -1 });
      expect(lowerRight).toMatchObject({ x: 1, y: 1 });
      expect(bottom).toMatchObject({ x: 0, y: 2 });
      expect(lowerLeft).toMatchObject({ x: -1, y: 1 });
      expect(upperLeft).toMatchObject({ x: -1, y: -1 });
    });
  });

  describe("Scenario: graph structure (property)", () => {
    it("every corner has 2 or 3 neighbours, matching its edges", () => {
      fc.assert(
        fc.property(vertexId, (id) => {
          const v = vertices[id];
          expect(v?.neighbours.length).toBeGreaterThanOrEqual(2);
          expect(v?.neighbours.length).toBeLessThanOrEqual(3);
          expect(v?.edges).toHaveLength(v?.neighbours.length ?? -1);
        }),
      );
    });

    it("neighbours are symmetric and joined by exactly one edge", () => {
      fc.assert(
        fc.property(vertexId, (id) => {
          for (const n of vertices[id]?.neighbours ?? []) {
            expect(vertices[n]?.neighbours).toContain(id);
            const edge = edgeBetween(id, n);
            expect(edge).toBeDefined();
            expect(edges[edge ?? -1]?.ends).toEqual([Math.min(id, n), Math.max(id, n)]);
          }
        }),
      );
    });

    it("neighbouring corners are one unit step apart", () => {
      for (const e of edges) {
        const [a, b] = e.ends.map((v) => vertices[v]);
        const dx = Math.abs((a?.x ?? 0) - (b?.x ?? 0));
        const dy = Math.abs((a?.y ?? 0) - (b?.y ?? 0));
        expect(`${dx},${dy}`).toMatch(/^(1,1|0,2)$/);
      }
    });

    it("lists the edges a corner is an end of", () => {
      for (const v of vertices) {
        for (const e of v.edges) expect(edges[e]?.ends).toContain(v.id);
      }
    });
  });

  describe("Scenario: lookups", () => {
    it("returns no edge between corners that are not neighbours", () => {
      const v = vertices[0];
      const far = vertices.find((w) => w.id !== v?.id && !v?.neighbours.includes(w.id));
      expect(edgeBetween(v?.id ?? 0, far?.id ?? 0)).toBeUndefined();
    });

    it("finds the edge in either direction", () => {
      const e = edges[10];
      expect(edgeBetween(e?.ends[1] ?? 0, e?.ends[0] ?? 0)).toBe(10);
    });

    it("builds the same topology every time", () => {
      expect(buildTopology(BOARD_POSITIONS)).toEqual(TOPOLOGY);
    });

    it("builds a single hex as six corners and six edges", () => {
      const single = buildTopology([[0, 0]]);
      expect(single.vertices).toHaveLength(6);
      expect(single.edges).toHaveLength(6);
      expect(single.vertices.every((v) => v.neighbours.length === 2)).toBe(true);
    });
  });
});
