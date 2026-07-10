export type FileNode = {
  name: string;
  path: string;
  type: "file";
  children: null;
};

export type FolderNode = {
  name: string;
  path: string;
  type: "folder";
  children: TreeNode[];
};

export type TreeNode = FileNode | FolderNode;

type MutableNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: Map<string, MutableNode> | null;
};

export function normalizePath(value: string | null | undefined): string {
  const parts = String(value || "")
    .replaceAll("\\", "/")
    .split("/");
  const output: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }

  return output.join("/");
}

export function buildFileTree(paths: string[]): TreeNode[] {
  const root: MutableNode = { name: "", path: "", type: "folder", children: new Map() };

  for (const filePath of [...paths].sort()) {
    const parts = normalizePath(filePath).split("/");
    let current = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      if (!current.children!.has(part)) {
        const path = parts.slice(0, index + 1).join("/");
        current.children!.set(part, {
          name: part,
          path,
          type: isFile ? "file" : "folder",
          children: isFile ? null : new Map(),
        });
      }
      current = current.children!.get(part)!;
    });
  }

  const serialize = (node: MutableNode): TreeNode => {
    if (node.type === "file") {
      return { name: node.name, path: node.path, type: "file", children: null };
    }
    return {
      name: node.name,
      path: node.path,
      type: "folder",
      children: [...node.children!.values()]
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .map(serialize),
    };
  };

  const tree = serialize(root);
  return tree.type === "folder" ? tree.children : [];
}

export function fileLanguage(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return (
    {
      js: "JavaScript",
      jsx: "JSX",
      ts: "TypeScript",
      tsx: "TSX",
      css: "CSS",
      html: "HTML",
      json: "JSON",
      md: "Markdown",
    }[extension || ""] || "Text"
  );
}
