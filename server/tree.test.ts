import { describe, expect, test } from "bun:test";
import { RelayTree } from "./tree";

describe("RelayTree", () => {
  test("fills the sharer first, then relays breadth-first", () => {
    const t = new RelayTree("S", 2);
    expect(t.add("a", 2)).toBe("S");
    expect(t.add("b", 2)).toBe("S");
    expect(t.add("c", 2)).toBe("a");
    expect(t.add("d", 2)).toBe("a");
    expect(t.add("e", 2)).toBe("b");
    expect(t.depthOf("e")).toBe(2);
  });

  test("viewers that do not relay never get children", () => {
    const t = new RelayTree("S", 1);
    t.add("a", 0);
    // No free slot anywhere: the sharer is overloaded instead of leaving b without video.
    expect(t.add("b", 2)).toBe("S");
    expect(t.add("c", 0)).toBe("b");
  });

  test("respects the depth limit", () => {
    const t = new RelayTree("S", 1, 2);
    t.add("a", 1);
    t.add("b", 1);
    expect(t.depthOf("b")).toBe(2);
    expect(t.add("c", 1)).toBe("S");
  });

  test("re-attaches orphans with their subtrees when a relay leaves", () => {
    const t = new RelayTree("S", 2);
    t.add("a", 2);
    t.add("b", 2);
    t.add("c", 2); // under a
    t.add("d", 2); // under a
    t.add("e", 2); // under b
    t.add("f", 2); // under b
    t.add("g", 1); // under c
    const { removed, added, depthChanged } = t.remove("a");
    expect(removed).toContainEqual({ parent: "S", child: "a" });
    expect(removed).toContainEqual({ parent: "a", child: "c" });
    expect(added.map((e) => e.child).sort()).toEqual(["c", "d"]);
    // c carries g along: g still hangs from c.
    expect(t.parentOf("g")).toBe("c");
    expect(added.find((e) => e.child === "c")!.parent).toBe("S");
    expect(depthChanged).toContain("g");
    expect(t.depthOf("g")).toBe(2);
    expect(t.size).toBe(6);
  });

  test("an orphan is never attached inside its own subtree", () => {
    const t = new RelayTree("S", 1);
    t.add("a", 1);
    t.add("b", 1);
    t.add("c", 1);
    t.remove("a");
    expect(t.parentOf("b")).toBe("S");
    expect(t.parentOf("c")).toBe("b");
  });
});
