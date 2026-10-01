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

/** Düz suite listesinden parentId'ye göre ağaç kurar; ebeveyni bulunamayanlar köke alınır. */
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

/** Ağacı derinlik öncelikli düz listeye çevirir (select seçenekleri için). */
export function flattenTree(roots: SuiteNode[]): SuiteNode[] {
  return roots.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** Bir suite ve tüm alt suite'lerinin id'leri. */
export function descendantIds(node: SuiteNode): Set<string> {
  const ids = new Set<string>([node.id]);
  for (const child of node.children) {
    for (const id of descendantIds(child)) ids.add(id);
  }
  return ids;
}

/** "Ödeme / Kart / 3D Secure" biçiminde suite yolu. */
export function suitePath(suites: Suite[], suiteId: string | null): string {
  if (!suiteId) return 'No suite';
  const byId = new Map(suites.map((s) => [s.id, s]));
  const names: string[] = [];
  let current = byId.get(suiteId);
  // Döngü koruması: API döngüyü engelliyor, yine de bozuk veride sonsuz döngüye girme.
  while (current && names.length < 20) {
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(' / ') || 'No suite';
}
