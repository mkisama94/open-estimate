import path from "node:path";

export interface FileClassification {
  category: "source" | "test" | "config" | "schema" | "doc" | "manifest" | "asset" | "binary" | "secret" | "other";
  language: string | null;
  isExcluded: boolean;
  exclusionReason: string | null;
}

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".nyc_output",
  ".open-estimate",
  ".open-estimate-cache"
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".mp3", ".wav", ".mp4", ".mov", ".avi", ".mkv",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm", ".class", ".pyc"
]);

const SECRET_PATTERNS = [
  /\.env(\..+)?$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /credentials\.json$/i,
  /service-account.*\.json$/i
];

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "markdown",
  ".sql": "sql",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".sh": "shell",
  ".bash": "shell",
  ".ps1": "powershell"
};

export function classifyFile(posixRelativePath: string): FileClassification {
  const parts = posixRelativePath.split("/");
  const fileName = parts[parts.length - 1];
  const ext = path.posix.extname(fileName).toLowerCase();

  // Check excluded directories
  for (const part of parts.slice(0, -1)) {
    if (EXCLUDED_DIRS.has(part)) {
      return {
        category: "other",
        language: null,
        isExcluded: true,
        exclusionReason: `Directory '${part}' is in standard exclusion list`
      };
    }
  }

  // Check root dir itself if fileName is one of them
  if (parts.length === 1 && EXCLUDED_DIRS.has(fileName)) {
    return {
      category: "other",
      language: null,
      isExcluded: true,
      exclusionReason: `Directory '${fileName}' is excluded`
    };
  }

  // Check secrets
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(fileName)) {
      // Allow .env.example unless secret keywords
      if (fileName === ".env.example" || fileName === ".env.template") {
        break;
      }
      return {
        category: "secret",
        language: null,
        isExcluded: true,
        exclusionReason: `File '${fileName}' matches potential secret pattern`
      };
    }
  }

  // Check binary extensions
  if (BINARY_EXTENSIONS.has(ext)) {
    return {
      category: "binary",
      language: null,
      isExcluded: true,
      exclusionReason: `Binary/media extension '${ext}' is excluded`
    };
  }

  const language = EXTENSION_LANGUAGE_MAP[ext] || null;

  // Determine category
  const lowerPath = posixRelativePath.toLowerCase();
  let category: FileClassification["category"] = "source";

  if (
    lowerPath.includes("/tests/") ||
    lowerPath.includes("/test/") ||
    lowerPath.includes("/__tests__/") ||
    /\.(test|spec)\.[a-z]+$/i.test(fileName)
  ) {
    category = "test";
  } else if (
    fileName === "package.json" ||
    fileName === "package-lock.json" ||
    fileName === "requirements.txt" ||
    fileName === "pyproject.toml" ||
    fileName === "cargo.toml" ||
    fileName === "go.mod"
  ) {
    category = "manifest";
  } else if (
    fileName.includes("schema") ||
    lowerPath.includes("/schemas/") ||
    lowerPath.includes("/contracts/")
  ) {
    category = "schema";
  } else if (
    ext === ".md" ||
    ext === ".txt" ||
    ext === ".rst" ||
    fileName.toLowerCase().startsWith("readme") ||
    fileName.toLowerCase().startsWith("license")
  ) {
    category = "doc";
  } else if (
    fileName.startsWith("tsconfig") ||
    fileName.startsWith(".eslintrc") ||
    fileName.startsWith("vitest.config") ||
    ext === ".yaml" ||
    ext === ".yml"
  ) {
    category = "config";
  }

  return {
    category,
    language,
    isExcluded: false,
    exclusionReason: null
  };
}
