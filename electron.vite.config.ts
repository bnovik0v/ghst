import { defineConfig } from "electron-vite";
import { resolve, basename } from "node:path";
import { copyFileSync, createReadStream, mkdirSync, readdirSync, statSync } from "node:fs";
import type { Plugin } from "vite";

const nm = (p: string) => resolve(__dirname, "node_modules", p);

/**
 * Copies VAD / ONNX Runtime assets into the renderer output at /vad/*.
 * Runs on build and on dev startup (via configureServer middleware).
 */
function vadAssetsPlugin(): Plugin {
  const sources: string[] = [
    nm("@ricky0123/vad-web/dist/silero_vad_v5.onnx"),
    nm("@ricky0123/vad-web/dist/silero_vad_legacy.onnx"),
    nm("@ricky0123/vad-web/dist/vad.worklet.bundle.min.js"),
    ...readdirSync(nm("onnxruntime-web/dist"))
      .filter((f) => f.endsWith(".wasm") || f.endsWith(".mjs"))
      .map((f) => nm(`onnxruntime-web/dist/${f}`)),
  ];

  const copyTo = (outDir: string) => {
    const dest = resolve(outDir, "vad");
    mkdirSync(dest, { recursive: true });
    for (const src of sources) {
      if (!statSync(src, { throwIfNoEntry: false })) continue;
      copyFileSync(src, resolve(dest, basename(src)));
    }
  };

  return {
    name: "ghst-vad-assets",
    apply: () => true,
    writeBundle(opts) {
      if (opts.dir) copyTo(opts.dir);
    },
    configureServer(server) {
      server.middlewares.use("/vad", (req, res, next) => {
        if (!req.url) return next();
        const name = req.url.split("?")[0].split("/").pop()!;
        const match = sources.find((s) => basename(s) === name);
        if (!match) return next();
        res.setHeader(
          "Content-Type",
          name.endsWith(".wasm")
            ? "application/wasm"
            : name.endsWith(".mjs") || name.endsWith(".js")
              ? "text/javascript"
              : "application/octet-stream",
        );
        createReadStream(match).pipe(res);
      });
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          worker: resolve(__dirname, "src/preload/worker.ts"),
          overlay: resolve(__dirname, "src/preload/overlay.ts"),
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    build: {
      rollupOptions: {
        input: {
          worker: resolve(__dirname, "src/renderer/worker/index.html"),
          overlay: resolve(__dirname, "src/renderer/overlay/index.html"),
        },
      },
    },
    plugins: [vadAssetsPlugin()],
  },
});
