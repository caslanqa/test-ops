export interface Suite {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
}

export interface SuiteNode extends Suite {
  children: SuiteNode[];
  depth: number;
}

/** Builds a tree from the flat suite list by parentId; suites whose parent is missing go to the root. */
export function buildSuiteTree(suites: Suite[]): SuiteNode[] {
  const nodes = new Map<string, SuiteNode>(
    suites.map((s) => [s.id, { ...s, children: [], depth: 0 }]),
  );
  const roots: SuiteNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const setDepth = (list: SuiteNode[], depth: number) => {
    for (const node of list) {
      node.depth = depth;
      setDepth(node.children, depth + 1);
    }
  };
  setDepth(roots, 0);
  return roots;
}

/** Flattens the tree into a depth-first list (for select options). */
export function flattenTree(roots: SuiteNode[]): SuiteNode[] {
  return roots.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** Ids of a suite and all of its descendant suites. */
export function descendantIds(node: SuiteNode): Set<string> {
  const ids = new Set<string>([node.id]);
  for (const child of node.children) {
    for (const id of descendantIds(child)) ids.add(id);
  }
  return ids;
}

/** Suite path in the form "Payments / Card / 3D Secure". */
export function suitePath(suites: Suite[], suiteId: string | null): string {
  if (!suiteId) return 'No suite';
  const byId = new Map(suites.map((s) => [s.id, s]));
  const names: string[] = [];
  let current = byId.get(suiteId);
  // Cycle guard: the API prevents cycles, but never loop forever on corrupt data anyway.
  while (current && names.length < 20) {
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(' / ') || 'No suite';
}
