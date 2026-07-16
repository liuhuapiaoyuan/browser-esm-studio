/**
 * Generate skill-store cover images via lite-image, upload to S3, print CDN URL map.
 *
 *   bun scripts/generate-skill-icons.ts
 *   bun scripts/generate-skill-icons.ts usage-tracking
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateLiteImage } from "../src/service/lite-image-generate.ts";

const STYLE_LOCK = [
  "Full-bleed square cover painting only, edge to edge,",
  "early 20th-century Chinese educational oil painting style,",
  "impressionistic brushstrokes, warm golden-hour cinematic lighting,",
  "amber gold burnt-orange deep brown palette,",
  "hopeful contemplative atmosphere, painterly textured canvas,",
  "crop tightly on the scene itself,",
  "absolutely no card frame, no border, no parchment panel, no paper UI,",
  "no text, no letters, no Chinese characters, no numbers, no watermark, no logo",
].join(" ");

const NEGATIVE =
  "text, letters, Chinese characters, numbers, calligraphy, watermark, logo, card frame, red border, parchment panel, cream paper, UI layout, buttons, badges, tags, title bar, caption, flat icon, vector sticker, neon, cyberpunk, anime, photoreal selfie, cluttered collage, split layout";

type SkillCover = {
  id: string;
  title: string;
  subject: string;
};

const SKILLS: SkillCover[] = [
  {
    id: "sandbox",
    title: "课件编辑",
    subject:
      "a scholar's wooden desk by a latticed window at sunrise, open lesson manuscript pages, ink brush and ruler, soft morning light on paper, quiet creative study room",
  },
  {
    id: "dynamic-db",
    title: "学习数据",
    subject:
      "stacked archival ledgers and scroll records on a warm wood shelf, glowing lamp light, tiny beads like progress counters, scholarly archive atmosphere",
  },
  {
    id: "interactive-quest",
    title: "参考仿作",
    subject:
      "two facing open books on a study table, one antique reference volume and one newly written notebook, candlelight, mirroring composition of learning by example",
  },
  {
    id: "quest-learning",
    title: "地图闯关",
    subject:
      "an adventurous hand-drawn treasure map spread on parchment under lantern light, winding path through hills and rivers, hopeful journey ahead",
  },
  {
    id: "panorama-showcase",
    title: "历程全景",
    subject:
      "wide panoramic view of a historical riverside cityscape at dawn, layered stages of buildings and bridges fading into golden mist, epic timeline feeling",
  },
  {
    id: "slide-courseware",
    title: "课件制作",
    subject:
      "a stack of lesson slides fanned on a wooden teacher's desk, chalk and pointer beside, warm classroom light through curtains, orderly page-turning teaching atmosphere",
  },
  {
    id: "text-interactive-game",
    title: "课文互动游戏",
    subject:
      "two historical figures facing each other in a dim clinic room, dramatic dialogue tableau, warm oil-lamp glow, literary stage-like composition of a textbook story coming alive",
  },
  {
    id: "usage-tracking",
    title: "学情追踪",
    subject:
      "a teacher's wooden attendance ledger open on a desk, ink brush marking student names, warm lantern light, quiet classroom after hours, scholarly record-keeping atmosphere",
  },
];

async function uploadLocal(filePath: string, key: string): Promise<string> {
  const proc = Bun.spawn(["bun", "scripts/upload-s3.ts", filePath, key], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`upload failed for ${key}: ${stderr || stdout}`);
  }
  const url = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!url?.startsWith("http")) {
    throw new Error(`upload returned no URL for ${key}: ${stdout}`);
  }
  return url;
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(filePath, buf);
}

async function main() {
  const outDir = join(process.cwd(), "scripts", ".skill-icon-tmp");
  mkdirSync(outDir, { recursive: true });

  const onlyIds = new Set(process.argv.slice(2).map((id) => id.trim().toLowerCase()).filter(Boolean));
  const targets = onlyIds.size
    ? SKILLS.filter((skill) => onlyIds.has(skill.id))
    : SKILLS;
  if (onlyIds.size && targets.length !== onlyIds.size) {
    const known = new Set(SKILLS.map((s) => s.id));
    const missing = [...onlyIds].filter((id) => !known.has(id));
    throw new Error(`unknown skill id(s): ${missing.join(", ")}`);
  }

  const map: Record<string, string> = {};

  for (const [index, skill] of targets.entries()) {
    const prompt = `${STYLE_LOCK}. Subject: ${skill.subject}.`;
    console.error(`generating ${skill.id} (${skill.title})...`);

    let tempUrl = "";
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const result = await generateLiteImage({
          prompt,
          negativePrompt: NEGATIVE,
          // Full-bleed painting only; omit img2img so card chrome is not copied.
          imageSize: "1024x1024",
          numInferenceSteps: 30,
          guidanceScale: 8,
        });
        tempUrl = result.images[0]?.url ?? "";
        if (!tempUrl) throw new Error(`no image url for ${skill.id}`);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  attempt ${attempt} failed: ${message}`);
        if (attempt === 5) throw error;
        await Bun.sleep(attempt * 8000);
      }
    }

    const localPath = join(outDir, `${skill.id}.png`);
    await downloadToFile(tempUrl, localPath);

    const cdnUrl = await uploadLocal(localPath, `skill-icons/${skill.id}.png`);
    map[skill.id] = cdnUrl;
    console.error(`  → ${cdnUrl}`);
    if (index < targets.length - 1) await Bun.sleep(4000);
  }

  const manifestPath = join(outDir, "manifest.json");
  let merged = map;
  if (onlyIds.size) {
    try {
      const prev = await Bun.file(manifestPath).json();
      if (prev && typeof prev === "object") merged = { ...prev, ...map };
    } catch {
      /* no prior manifest */
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(JSON.stringify(merged, null, 2));
  console.error(`wrote ${manifestPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
