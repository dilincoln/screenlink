// Relay tree of one stream. The sharer is the root; every viewer gets its video from exactly one
// parent (the sharer or another viewer) and may forward it to up to `capacity` children. The
// server never touches media: it only decides who connects to whom.

export type Edge = { parent: string; child: string };

type Node = {
  id: string;
  parent: string | null;
  children: Set<string>;
  capacity: number;
  depth: number;
};

export class RelayTree {
  readonly rootId: string;
  readonly maxDepth: number;
  private nodes = new Map<string, Node>();

  /**
   * @param rootCapacity direct viewers the sharer serves before viewers start relaying.
   * @param maxDepth hops allowed between the sharer and the farthest viewer; every hop costs a
   *   decode + encode on the relaying viewer, so this caps the added latency.
   */
  constructor(rootId: string, rootCapacity: number, maxDepth = 4) {
    this.rootId = rootId;
    this.maxDepth = Math.max(1, maxDepth);
    this.nodes.set(rootId, { id: rootId, parent: null, children: new Set(), capacity: Math.max(1, rootCapacity), depth: 0 });
  }

  has(id: string) {
    return this.nodes.has(id);
  }

  get size() {
    return this.nodes.size - 1;
  }

  parentOf(id: string) {
    return this.nodes.get(id)?.parent ?? null;
  }

  depthOf(id: string) {
    return this.nodes.get(id)?.depth ?? -1;
  }

  childrenOf(id: string): string[] {
    return [...(this.nodes.get(id)?.children ?? [])];
  }

  viewers(): string[] {
    return [...this.nodes.keys()].filter((id) => id !== this.rootId);
  }

  /** Adds a viewer and returns its parent. */
  add(id: string, capacity: number): string {
    if (this.nodes.has(id)) throw new Error(`${id} is already in the tree`);
    const node: Node = { id, parent: null, children: new Set(), capacity: Math.max(0, capacity), depth: 0 };
    this.nodes.set(id, node);
    return this.attach(node);
  }

  /**
   * Removes a viewer. Its children (each with its own subtree) are re-attached elsewhere.
   * Returns the edges that disappeared, the ones created, and every viewer whose depth changed.
   */
  remove(id: string): { removed: Edge[]; added: Edge[]; depthChanged: string[] } {
    const node = this.nodes.get(id);
    if (!node || id === this.rootId) return { removed: [], added: [], depthChanged: [] };

    const removed: Edge[] = [];
    if (node.parent) {
      this.nodes.get(node.parent)!.children.delete(id);
      removed.push({ parent: node.parent, child: id });
    }
    const orphans = [...node.children].map((c) => this.nodes.get(c)!);
    for (const orphan of orphans) {
      removed.push({ parent: id, child: orphan.id });
      orphan.parent = null;
    }
    this.nodes.delete(id);

    const before = new Map([...this.nodes.values()].map((n) => [n.id, n.depth]));
    // Biggest subtrees first: they are the hardest to fit under the depth limit.
    orphans.sort((a, b) => this.height(b) - this.height(a));
    const added = orphans.map((orphan) => ({ parent: this.attach(orphan), child: orphan.id }));
    const depthChanged = [...this.nodes.values()].filter((n) => before.get(n.id) !== n.depth).map((n) => n.id);
    return { removed, added, depthChanged };
  }

  private attach(node: Node): string {
    const parent = this.findSlot(node) ?? this.nodes.get(this.rootId)!;
    node.parent = parent.id;
    parent.children.add(node.id);
    this.setDepth(node, parent.depth + 1);
    return parent.id;
  }

  /**
   * Shallowest node with a free slot that keeps the whole subtree of `node` within maxDepth.
   * Null when there is none: the caller then overloads the sharer rather than leaving the viewer
   * without video.
   */
  private findSlot(node: Node): Node | null {
    const height = this.height(node);
    const queue = [this.nodes.get(this.rootId)!];
    while (queue.length) {
      const candidate = queue.shift()!;
      if (candidate.depth + 1 + height > this.maxDepth) break;
      if (candidate.children.size < candidate.capacity) return candidate;
      for (const c of candidate.children) queue.push(this.nodes.get(c)!);
    }
    return null;
  }

  private height(node: Node): number {
    let h = 0;
    for (const c of node.children) h = Math.max(h, 1 + this.height(this.nodes.get(c)!));
    return h;
  }

  private setDepth(node: Node, depth: number) {
    node.depth = depth;
    for (const c of node.children) this.setDepth(this.nodes.get(c)!, depth + 1);
  }
}
