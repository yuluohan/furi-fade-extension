const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const rootDir = path.resolve(__dirname, "..");
const defaultSource = "/private/tmp/JMdict_e.gz";
const options = parseArgs(process.argv.slice(2));
const sourcePath = options.sourcePath || defaultSource;
const outputPath =
  options.outputPath || path.join(rootDir, "src", "dictionary", "data", "jmdictCommonData.js");
const tier = options.tier || process.env.JMDICT_TIER || "priority";
const defaultLimit = tier === "common" ? 5000 : tier === "priority" ? 0 : 0;
const maxEntries = options.limit ?? numberFromEnv("JMDICT_COMMON_LIMIT", defaultLimit);
const FORCED_SURFACES = new Set([
  "日本",
  "日本語",
  "東京",
  "学校",
  "先生",
  "学生",
  "言葉",
  "勉強",
  "確認",
  "見る",
  "行く",
  "食べる",
  "読む",
  "書く",
  "大切"
]);

if (!fs.existsSync(sourcePath)) {
  throw new Error(`JMdict source not found: ${sourcePath}`);
}

const xml = zlib.gunzipSync(fs.readFileSync(sourcePath)).toString("utf8");
const entries = [];

for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
  const parsed = parseEntry(match[1]);
  if (!parsed) continue;
  entries.push(...(tier === "full" ? parsed.entries : parsed.entries.filter((entry) => entry.priorityScore > 0)));
}

const tierEntries = entries
  .sort((a, b) => b.priorityScore - a.priorityScore || a.surface.localeCompare(b.surface, "ja"))
  .slice(0, maxEntries > 0 ? maxEntries : undefined)
  .map(({ priorityScore, ...entry }) => entry);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, createDataFile(tierEntries, { tier, maxEntries }), "utf8");

console.log(`Generated ${tierEntries.length} JMdict ${tier} entries: ${path.relative(rootDir, outputPath)}`);

function parseArgs(args) {
  const parsed = {
    sourcePath: null,
    outputPath: null,
    tier: null,
    limit: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--tier") parsed.tier = args[++index];
    else if (arg.startsWith("--tier=")) parsed.tier = arg.slice("--tier=".length);
    else if (arg === "--limit") parsed.limit = Number(args[++index]);
    else if (arg.startsWith("--limit=")) parsed.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--output") parsed.outputPath = path.resolve(args[++index]);
    else if (arg.startsWith("--output=")) parsed.outputPath = path.resolve(arg.slice("--output=".length));
    else if (arg === "--source") parsed.sourcePath = args[++index];
    else if (arg.startsWith("--source=")) parsed.sourcePath = arg.slice("--source=".length);
    else if (!arg.startsWith("--") && !parsed.sourcePath) parsed.sourcePath = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!["common", "priority", "full"].includes(parsed.tier || "priority")) {
    throw new Error(`Unsupported JMdict tier: ${parsed.tier}`);
  }
  if (parsed.limit !== null && (!Number.isFinite(parsed.limit) || parsed.limit < 0)) {
    throw new Error(`Invalid --limit: ${parsed.limit}`);
  }
  return parsed;
}

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${name}: ${value}`);
  return number;
}

function parseEntry(entryXml) {
  const sequence = getText(entryXml, "ent_seq");
  const kanjiElements = [...entryXml.matchAll(/<k_ele>([\s\S]*?)<\/k_ele>/g)].map((item) => ({
    surface: getText(item[1], "keb"),
    priorities: getAllText(item[1], "ke_pri")
  }));
  const readingElements = [...entryXml.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/g)].map((item) => ({
    reading: getText(item[1], "reb"),
    priorities: getAllText(item[1], "re_pri")
  }));
  const senses = [...entryXml.matchAll(/<sense>([\s\S]*?)<\/sense>/g)].map((item) => parseSense(item[1]));
  const meanings = senses.flatMap((sense) => sense.glosses).filter(Boolean).slice(0, 4);

  if (readingElements.length === 0 || meanings.length === 0) return null;

  const priorityCodes = [
    ...kanjiElements.flatMap((item) => item.priorities),
    ...readingElements.flatMap((item) => item.priorities)
  ];
  const priorityScore = getPriorityScore(priorityCodes);
  const firstReading = readingElements[0].reading;
  const partOfSpeech = [...new Set(senses.flatMap((sense) => sense.partsOfSpeech))];
  const surfaces = kanjiElements.length > 0
    ? kanjiElements.map((item) => item.surface)
    : readingElements.map((item) => item.reading);
  const lexicalSurfaces = [...new Set(surfaces.filter(isUsefulJapaneseSurface))];
  if (lexicalSurfaces.length === 0) return null;

  return {
    priorityScore,
    entries: lexicalSurfaces.map((surface) => ({
      priorityScore: priorityScore + (FORCED_SURFACES.has(surface) ? 10000 : 0),
      surface,
      baseForm: surface,
      reading: firstReading,
      meanings: {
        en: meanings
      },
      partOfSpeech: partOfSpeech.length ? partOfSpeech : ["unknown"],
      source: {
        provider: "jmdict",
        entryId: sequence,
        confidence: 0.9
      },
      priority: priorityCodes.slice(0, 4)
    }))
  };
}

function isUsefulJapaneseSurface(surface) {
  if (!surface) return false;
  if (!/[\u3040-\u30ff\u3400-\u9fff]/u.test(surface)) return false;
  if (/^[\p{P}\p{S}\s]+$/u.test(surface)) return false;
  if (/^[0-9０-９]/u.test(surface)) return false;
  return surface.length > 1 || /[\u3400-\u9fff]/u.test(surface);
}

function parseSense(senseXml) {
  return {
    glosses: getAllText(senseXml, "gloss").filter((value) => !/^\s*$/u.test(value)),
    partsOfSpeech: getAllText(senseXml, "pos").map(mapPartOfSpeech)
  };
}

function getText(xml, tagName) {
  return decodeXml(xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`))?.[1] || "");
}

function getAllText(xml, tagName) {
  return [...xml.matchAll(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "g"))]
    .map((match) => decodeXml(match[1]));
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&([a-z0-9-]+);/gi, "$1")
    .trim();
}

function getPriorityScore(codes) {
  let score = 0;
  for (const code of codes) {
    if (code === "ichi1") score += 100;
    else if (code === "news1") score += 90;
    else if (code === "spec1") score += 80;
    else if (code === "gai1") score += 70;
    else if (code === "ichi2") score += 60;
    else if (code === "news2") score += 50;
    else if (code === "spec2") score += 40;
    else if (code === "gai2") score += 30;
    else if (/^nf\d+$/u.test(code)) score += Math.max(1, 50 - Number(code.slice(2)));
  }
  return score;
}

function mapPartOfSpeech(pos) {
  const normalized = pos.replace(/^&|;$/g, "");
  const known = {
    n: "noun",
    "n-adv": "adverbial-noun",
    "n-suf": "noun-suffix",
    adj: "adjective",
    "adj-i": "i-adjective",
    "adj-na": "na-adjective",
    adv: "adverb",
    aux: "auxiliary",
    exp: "expression",
    int: "interjection",
    pref: "prefix",
    suf: "suffix",
    "v1": "ichidan-verb",
    "v5k": "godan-verb",
    "v5r": "godan-verb",
    "vs": "suru-verb",
    "vt": "transitive-verb",
    "vi": "intransitive-verb"
  };
  return known[normalized] || normalized || "unknown";
}

function createDataFile(data, { tier, maxEntries }) {
  const tierKey = tier === "full" ? "full" : tier === "common" ? "common" : "priority";
  return `(() => {
  "use strict";

  window.FadingFuriganaJmdictData = {
    metadata: {
      source: "JMdict",
      sourceUrl: "https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project",
      license: "Creative Commons Attribution-ShareAlike",
      generatedAt: ${JSON.stringify(new Date().toISOString())},
      tier: ${JSON.stringify(tierKey)},
      entryCount: ${data.length},
      tiers: {
        ${tierKey}: {
          entryCount: ${data.length},
          eager: ${tierKey !== "full"},
          limit: ${maxEntries > 0 ? maxEntries : "null"}
        }
      }
    },
    entries: ${JSON.stringify(data)}
  };
})();
`;
}
