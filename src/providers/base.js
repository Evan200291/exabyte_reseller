export const categories = {
  game_topups: "Game Top-ups (Instant Delivery)",
  gift_cards: "Gift Cards & Vouchers (Instant Delivery)",
  ai_products: "AI Products (Instant Delivery)",
  digital_products: "Digital Products (Instant Delivery)"
};

export const apiDocs = {
  store: "/api/store",
  products: "/api/products",
  productsCategory: "/api/products?category=ai_products",
  product: "/api/products/:localId",
  settings: "/api/settings",
  payments: "/api/payments",
  orders: "/api/orders"
};

export function cleanProductName(value) {
  let text = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const replacements = [
    [/ngay|ng\S*y/gi, "days"],
    [/thang|th\S*ng/gi, "month"],
    [/tai khoan|tai\S* kho\S*n|acc c\S*p|acc cap/gi, "account"],
    [/bao hanh|bao\S* hanh/gi, "warranty"]
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim();
}

export function familyForName(name, fallback = "Other") {
  const text = cleanProductName(name).toLowerCase();
  const rules = [
    ["chatgpt", "ChatGPT"], ["chat gpt", "ChatGPT"], ["openai", "ChatGPT"], ["claude", "Claude"], ["gemini", "Gemini"], ["gamma", "Gamma AI"],
    ["grok", "Grok"], ["cursor", "Cursor AI"], ["adobe", "Adobe"], ["eleven", "ElevenLabs"],
    ["11labs", "ElevenLabs"], ["midjourney", "Midjourney"], ["copilot", "Copilot"],
    ["capcut", "CapCut"], ["canva", "Canva"], ["meitu", "Meitu"], ["figma", "Figma"],
    ["perplexity", "Perplexity"], ["notion", "Notion"], ["deepl", "DeepL"], ["quillbot", "QuillBot"],
    ["netflix", "Netflix"], ["spotify", "Spotify"], ["youtube", "YouTube"], ["steam", "Steam"],
    ["roblox", "Roblox"], ["pubg", "PUBG"], ["mobile legends", "Mobile Legends"],
    ["free fire", "Free Fire"], ["valorant", "Valorant"], ["google", "Google"],
    ["apple", "Apple"], ["amazon", "Amazon"]
  ];
  return rules.find(([needle]) => text.includes(needle))?.[1] || fallback;
}

export function categoryForName(name, providerHint = "") {
  const text = `${name || ""} ${providerHint}`.toLowerCase();
  if (/mobile legends|pubg|free fire|valorant|genshin|roblox|minecraft|new state|merge kingdoms|game|top.?up|diamond|uc\b/.test(text)) return "game_topups";
  if (/chatgpt|chat gpt|openai|claude|gemini|gamma|grok|cursor|adobe|eleven|11labs|midjourney|copilot|perplexity|notion ai|quillbot|ai\b/.test(text)) return "ai_products";
  if (/gift|voucher|card|netflix|spotify|steam|google play|apple|amazon|itunes|psn|playstation|xbox gift|razer gold|nintendo eshop/.test(text)) return "gift_cards";
  return "digital_products";
}

// Region detection so Netflix / Spotify etc. can be split into US / Global / Turkey / etc.
const REGION_RULES = [
  [/\b(us|u\.s\.|usa|united states|america|american)\b/i, "US"],
  [/\b(uk|u\.k\.|united kingdom|britain|british)\b/i, "UK"],
  [/\b(eu|europe|european)\b/i, "EU"],
  [/\b(tr|turkey|turkish|turkiye)\b/i, "Turkey"],
  [/\b(id|indonesia|indonesian)\b/i, "Indonesia"],
  [/\b(ph|philippines|filipino)\b/i, "Philippines"],
  [/\b(sg|singapore)\b/i, "Singapore"],
  [/\b(my|malaysia)\b/i, "Malaysia"],
  [/\b(vn|vietnam|viet nam)\b/i, "Vietnam"],
  [/\b(th|thailand|thai)\b/i, "Thailand"],
  [/\b(in|india|indian)\b/i, "India"],
  [/\b(pk|pakistan)\b/i, "Pakistan"],
  [/\b(br|brazil|brasil)\b/i, "Brazil"],
  [/\b(ar|argentina)\b/i, "Argentina"],
  [/\b(mx|mexico|mexican)\b/i, "Mexico"],
  [/\b(ca|canada|canadian)\b/i, "Canada"],
  [/\b(au|australia|australian)\b/i, "Australia"],
  [/\b(jp|japan|japanese)\b/i, "Japan"],
  [/\b(kr|korea|korean)\b/i, "Korea"],
  [/\b(cn|china|chinese)\b/i, "China"],
  [/\b(hk|hong kong)\b/i, "Hong Kong"],
  [/\b(tw|taiwan|taiwanese)\b/i, "Taiwan"],
  [/\b(sa|saudi|ksa)\b/i, "Saudi Arabia"],
  [/\b(ae|uae|emirates)\b/i, "UAE"],
  [/\b(mm|myanmar|burma)\b/i, "Myanmar"],
  [/\b(global|worldwide|world|international|intl)\b/i, "Global"]
];

export function regionFrom(...sources) {
  const text = sources.filter(Boolean).map(String).join(" ");
  for (const [pattern, region] of REGION_RULES) if (pattern.test(text)) return region;
  return "Default";
}

export function stockFrom(value, fallback = 0) {
  const raw = value?.stock ?? value?.qty ?? value?.quantity ?? value?.available_stock ?? value?.available ?? fallback;
  if (typeof raw === "boolean") return raw ? fallback || 999 : 0;
  const valueNumber = Number(raw);
  if (Number.isFinite(valueNumber)) return valueNumber;
  const text = String(raw).toLowerCase();
  if (/out|sold|unavailable|empty|none|zero/.test(text)) return 0;
  if (/in|available|yes/.test(text)) return fallback || 999;
  return fallback;
}

export class Provider {
  constructor(options) {
    this.id = options.id;
    this.name = options.name;
    this.baseUrl = (options.baseUrl || "").replace(/\/$/, "");
    this.apiKey = options.apiKey || "";
  }

  enabled() { return Boolean(this.baseUrl); }
  async syncProducts() { return []; }
  async buy() { throw new Error(`${this.name} purchase is not implemented`); }
  async validatePlayer() { return null; }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = options.timeoutMs || 8000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {})
        }
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok || data.success === false) {
      const err = new Error(data.error || data.message || `HTTP ${response.status}`);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  }
}