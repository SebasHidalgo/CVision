import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}/` },
      // Next resolves `server-only` to its empty module under the react-server
      // condition; plain Node gets the entry that throws. The code under test is
      // server code, so resolve it the way Next does.
      {
        find: /^server-only$/,
        replacement: path.resolve(root, "node_modules/server-only/empty.js"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: [...configDefaults.exclude, ".next/**"],
    setupFiles: ["./vitest.setup.ts"],
    unstubGlobals: true,
    restoreMocks: true,
  },
});
