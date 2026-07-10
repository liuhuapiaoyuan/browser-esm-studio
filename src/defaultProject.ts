import type { FileMap } from "./types";

export const DEFAULT_FILES: FileMap = {
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Orbit — AI workspace</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>`,
  "package.json": `{
  "name": "orbit-preview-project",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build"
  },
  "dependencies": {
    "lucide-react": "^0.468.0",
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "react-router-dom": "^7.6.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.10",
    "@types/react-dom": "^19.0.4",
    "@vitejs/plugin-react": "latest",
    "typescript": "~5.7.3",
    "vite": "latest"
  }
}`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src"]
}`,
  "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`,
  "src/main.tsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
`,
  "src/content.ts": `export const content = {
  eyebrow: "AI PRODUCT STUDIO",
  title: "Build at the speed of thought.",
  description:
    "From one prompt to a production-ready experience — designed, refined, and ready to ship.",
  primaryAction: "Start creating",
  secondaryAction: "Explore projects",
} as const;
`,
  "src/App.tsx": `import type { ReactNode } from "react";
import { ArrowRight, Box, Layers3, Sparkles, WandSparkles } from "lucide-react";
import { content } from "./content.ts";

function Feature({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <article className="feature">
      <div className="feature-icon">{icon}</div>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </article>
  );
}

export function App() {
  return (
    <main className="page">
      <nav className="nav">
        <a className="brand" href="#">
          <span className="brand-mark">
            <Sparkles size={18} />
          </span>
          orbit
        </a>
        <div className="nav-links">
          <a href="#features">Product</a>
          <a href="#">Resources</a>
          <button className="nav-button" type="button">
            Open workspace
          </button>
        </div>
      </nav>

      <section className="hero">
        <div className="orb orb-one" />
        <div className="orb orb-two" />
        <div className="hero-copy">
          <span className="eyebrow">
            <WandSparkles size={15} />
            {content.eyebrow}
          </span>
          <h1>{content.title}</h1>
          <p className="lede">{content.description}</p>
          <div className="actions">
            <button className="primary" type="button">
              {content.primaryAction}
              <ArrowRight size={17} />
            </button>
            <button className="secondary" type="button">
              {content.secondaryAction}
            </button>
          </div>
        </div>
        <div className="visual">
          <div className="visual-glow" />
          <div className="card card-back">
            <span>Design system</span>
            <Layers3 size={54} />
          </div>
          <div className="card card-front">
            <div className="card-top">
              <span>Live project</span>
              <i>Ready</i>
            </div>
            <div className="mini-window">
              <div className="mini-sidebar" />
              <div className="mini-content">
                <b />
                <span />
                <span />
              </div>
            </div>
            <div className="card-footer">
              <Box size={16} />
              8 files · ESM runtime
            </div>
          </div>
        </div>
      </section>

      <section className="features" id="features">
        <Feature
          icon={<Sparkles size={20} />}
          title="Prompt to product"
          text="Turn an idea into a polished interface in a focused flow."
        />
        <Feature
          icon={<Layers3 size={20} />}
          title="Real source files"
          text="Every iteration stays visible, editable, and portable."
        />
        <Feature
          icon={<Box size={20} />}
          title="Ship anywhere"
          text="Export the complete project and build with your own pipeline."
        />
      </section>
    </main>
  );
}
`,
  "src/styles.css": `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@500;600;700&display=swap');

:root {
  font-family: "DM Sans", system-ui, sans-serif;
  color: #f7f7f5;
  background: #11120f;
  font-synthesis: none;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; min-width: 320px; background: #11120f; }
button, a { font: inherit; }
button { cursor: pointer; }
a { color: inherit; text-decoration: none; }

.page { min-height: 100vh; overflow: hidden; background: radial-gradient(circle at 80% 12%, rgba(197, 255, 92, .08), transparent 26%), #11120f; }
.nav { height: 76px; padding: 0 clamp(24px, 5vw, 72px); display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,.07); }
.brand { display: flex; align-items: center; gap: 10px; font: 700 22px Manrope, sans-serif; letter-spacing: -.5px; }
.brand-mark { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; color: #11120f; background: #c9ff64; box-shadow: 0 0 30px rgba(201,255,100,.18); }
.nav-links { display: flex; align-items: center; gap: 28px; font-size: 14px; color: #b5b8ae; }
.nav-links a:hover { color: white; }
.nav-button { color: #f7f7f5; border: 1px solid rgba(255,255,255,.15); border-radius: 10px; padding: 10px 15px; background: rgba(255,255,255,.04); }

.hero { position: relative; min-height: 670px; padding: 110px clamp(24px, 6vw, 92px) 80px; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(420px, .95fr); align-items: center; gap: 72px; }
.hero-copy { position: relative; z-index: 2; max-width: 720px; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; color: #c9ff64; font-size: 12px; font-weight: 700; letter-spacing: 1.8px; }
h1 { max-width: 720px; margin: 22px 0 24px; font: 600 clamp(58px, 7vw, 94px)/.98 Manrope, sans-serif; letter-spacing: -5px; }
.lede { max-width: 570px; margin: 0; color: #a7aa9f; font-size: clamp(18px, 2vw, 21px); line-height: 1.65; }
.actions { display: flex; gap: 12px; margin-top: 38px; }
.actions button { min-height: 50px; padding: 0 21px; border-radius: 12px; border: 0; font-weight: 600; }
.primary { display: inline-flex; gap: 10px; align-items: center; color: #11120f; background: #c9ff64; box-shadow: 0 16px 40px rgba(180,239,72,.12); }
.secondary { color: #f6f6f2; background: #23251f; border: 1px solid rgba(255,255,255,.08) !important; }

.visual { position: relative; height: 470px; perspective: 1200px; }
.visual-glow { position: absolute; width: 420px; height: 420px; right: 20px; top: 10px; border-radius: 50%; background: rgba(201,255,100,.16); filter: blur(90px); }
.card { position: absolute; border: 1px solid rgba(255,255,255,.12); border-radius: 22px; background: linear-gradient(145deg, rgba(44,47,38,.95), rgba(25,27,23,.94)); box-shadow: 0 40px 90px rgba(0,0,0,.42); backdrop-filter: blur(18px); }
.card-back { width: 270px; height: 310px; right: 4px; top: 28px; padding: 24px; display: flex; flex-direction: column; justify-content: space-between; color: #8e9385; transform: rotateY(-13deg) rotateZ(6deg); }
.card-back svg { color: #c9ff64; align-self: flex-end; }
.card-front { width: min(440px, 90%); height: 342px; left: 0; bottom: 18px; padding: 20px; transform: rotateY(7deg) rotateZ(-2deg); }
.card-top, .card-footer { display: flex; align-items: center; justify-content: space-between; color: #d7dacd; font-size: 13px; }
.card-top i { padding: 5px 8px; color: #c9ff64; font-style: normal; background: rgba(201,255,100,.09); border-radius: 99px; }
.mini-window { height: 220px; margin: 18px 0; display: grid; grid-template-columns: 68px 1fr; overflow: hidden; border-radius: 13px; background: #eeefe9; }
.mini-sidebar { background: #d8dad2; border-right: 1px solid #c7c9c1; }
.mini-content { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; padding: 32px; gap: 11px; }
.mini-content b { width: 72%; height: 26px; border-radius: 5px; background: #31352c; }
.mini-content span { width: 90%; height: 8px; border-radius: 9px; background: #c5c8be; }
.mini-content span:last-child { width: 62%; }
.card-footer { justify-content: flex-start; gap: 8px; color: #92978a; }
.orb { position: absolute; border: 1px solid rgba(201,255,100,.14); border-radius: 50%; }
.orb-one { width: 420px; height: 420px; left: -260px; top: 120px; }
.orb-two { width: 120px; height: 120px; right: 32%; bottom: -30px; }

.features { margin: 0 clamp(24px, 6vw, 92px); padding: 36px 0 70px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; border-top: 1px solid rgba(255,255,255,.08); }
.feature { display: grid; grid-template-columns: auto 1fr; gap: 16px; padding: 22px 18px; }
.feature-icon { width: 42px; height: 42px; display: grid; place-items: center; color: #c9ff64; border-radius: 12px; background: rgba(201,255,100,.08); }
.feature h3 { margin: 1px 0 7px; font-size: 15px; }
.feature p { margin: 0; color: #858a7d; font-size: 13px; line-height: 1.55; }

@media (max-width: 900px) {
  .nav-links a { display: none; }
  .hero { padding-top: 74px; grid-template-columns: 1fr; gap: 48px; }
  .visual { height: 410px; }
  .features { grid-template-columns: 1fr; }
  h1 { letter-spacing: -3px; }
}
`,
  "README.md": `# Orbit preview project

This project was created in Browser ESM Studio.

## Local development

\`\`\`bash
bun install
bun run dev
\`\`\`

## Production build

\`\`\`bash
bun install
bun run build
\`\`\`
`,
};
