/**
 * quickNotes.ts — Rekomendasi catatan sekali klik (Quick Note Chips) yang
 * menyesuaikan jenis menu secara otomatis berdasarkan nama menu, kategori,
 * deskripsi, dan label produk.
 *
 * Konsep MVP: varian (gula, es, level pedas, dll.) disimpan sebagai teks
 * di kolom `notes` per item, sehingga tidak butuh perubahan skema database.
 */

export interface QuickNoteGroup {
  /** ID unik grup (dipakai untuk eksklusivitas pilihan) */
  id: string;
  /** Label grup yang tampil kecil di tab / chip */
  label: string;
  /** Jika true, hanya satu opsi dalam grup yang boleh aktif (mis. level gula) */
  exclusive: boolean;
  options: string[];
}

interface ProductLike {
  name: string;
  description?: string | null;
  labels?: string[] | null;
}

type MenuKind =
  | "coffee"
  | "tea"
  | "milk"
  | "juice"
  | "spicy_food"
  | "rice_noodle"
  | "fried_snack"
  | "bread_pastry"
  | "dessert"
  | "soup"
  | "general";

const KEYWORDS: Record<Exclude<MenuKind, "general">, string[]> = {
  coffee: [
    "kopi",
    "coffee",
    "espresso",
    "latte",
    "cappuccino",
    "capucino",
    "americano",
    "macchiato",
    "mocha",
    "mochaccino",
    "affogato",
    "v60",
    "vietnam drip",
    "kopsu",
    "piccolo",
    "flat white",
    "cold brew",
  ],
  tea: [
    "teh",
    "tea",
    "matcha",
    "thai tea",
    "lychee tea",
    "lemon tea",
    "green tea",
    "chamomile",
    "oolong",
    "earl grey",
  ],
  milk: [
    "susu",
    "milk",
    "chocolate",
    "coklat",
    "cokelat",
    "taro",
    "red velvet",
    "milkshake",
    "frappe",
    "boba",
    "smoothie",
    "yakult",
  ],
  juice: [
    "jus",
    "juice",
    "es jeruk",
    "jeruk",
    "lemon",
    "mojito",
    "soda",
    "squash",
    "lemonade",
    "es buah",
    "kelapa",
    "alpukat",
  ],
  spicy_food: [
    "ayam geprek",
    "geprek",
    "sambal",
    "pedas",
    "seblak",
    "balado",
    "rica",
    "mercon",
    "penyet",
    "lalapan",
    "pecel",
  ],
  rice_noodle: [
    "nasi",
    "rice",
    "mie",
    "mi",
    "bakmi",
    "noodle",
    "kwetiau",
    "bihun",
    "ramen",
    "pasta",
    "spaghetti",
    "fettuccine",
    "carbonara",
    "bolognese",
    "rice bowl",
    "katsu",
    "teriyaki",
    "ayam",
    "chicken",
    "beef",
    "sapi",
    "steak",
    "sirloin",
    "tenderloin",
    "wagyu",
    "burger",
  ],
  fried_snack: [
    "kentang",
    "fries",
    "french fries",
    "cireng",
    "tahu",
    "tempe",
    "pisang goreng",
    "dimsum",
    "siomay",
    "nugget",
    "sosis",
    "risol",
    "mendoan",
    "onion ring",
    "chicken wings",
    "wings",
    "snack",
    "camilan",
  ],
  bread_pastry: [
    "roti",
    "toast",
    "croissant",
    "bread",
    "sandwich",
    "pastry",
    "danish",
    "bagel",
    "waffle",
    "pancake",
    "donat",
    "donut",
  ],
  dessert: [
    "cake",
    "kue",
    "brownies",
    "pudding",
    "puding",
    "es krim",
    "ice cream",
    "gelato",
    "tiramisu",
    "cheesecake",
    "dessert",
    "panna cotta",
    "klepon",
  ],
  soup: ["soto", "sop", "sup", "soup", "bakso", "rawon", "tongseng", "gulai", "tom yum"],
};

const DRINK_CATEGORY_HINTS = ["minum", "drink", "beverage", "kopi", "coffee", "tea", "teh", "jus", "juice", "non coffee", "non-coffee"];
const FOOD_CATEGORY_HINTS = ["makan", "food", "main course", "nasi", "mie", "rice", "berat", "lauk"];
const SNACK_CATEGORY_HINTS = ["snack", "camilan", "cemilan", "appetizer", "side", "gorengan", "light meal"];
const DESSERT_CATEGORY_HINTS = ["dessert", "kue", "cake", "pastry", "manis", "sweet", "roti", "bakery"];

/** Cek kecocokan kata utuh (word boundary) agar "steak" tidak cocok dengan "tea" */
function matchesKeyword(haystack: string, keyword: string): boolean {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return regex.test(haystack);
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((n) => matchesKeyword(haystack, n));
}

function detectKinds(product: ProductLike, categoryName?: string | null): MenuKind[] {
  const text = ` ${product.name} ${product.description ?? ""} ${(product.labels ?? []).join(" ")} `.toLowerCase();
  const cat = (categoryName ?? "").toLowerCase();
  const kinds = new Set<MenuKind>();

  (Object.keys(KEYWORDS) as Exclude<MenuKind, "general">[]).forEach((kind) => {
    if (includesAny(text, KEYWORDS[kind])) kinds.add(kind);
  });

  if (kinds.size === 0 && cat) {
    if (includesAny(cat, ["kopi", "coffee"])) kinds.add("coffee");
    else if (includesAny(cat, ["teh", "tea"])) kinds.add("tea");
    else if (includesAny(cat, ["jus", "juice"])) kinds.add("juice");
    else if (includesAny(cat, DRINK_CATEGORY_HINTS)) kinds.add("milk");
    else if (includesAny(cat, DESSERT_CATEGORY_HINTS)) kinds.add("dessert");
    else if (includesAny(cat, SNACK_CATEGORY_HINTS)) kinds.add("fried_snack");
    else if (includesAny(cat, FOOD_CATEGORY_HINTS)) kinds.add("rice_noodle");
  }

  const isDrink = kinds.has("coffee") || kinds.has("tea") || kinds.has("juice") || kinds.has("milk");
  if (isDrink) {
    kinds.delete("rice_noodle");
    kinds.delete("fried_snack");
    kinds.delete("spicy_food");
    kinds.delete("soup");
    if (kinds.has("coffee")) kinds.delete("milk");
  }

  // Jika makanan berat (rice_noodle), jangan gabungkan dengan fried_snack kecuali memang snack
  if (kinds.has("rice_noodle") && kinds.has("fried_snack") && !includesAny(cat, SNACK_CATEGORY_HINTS)) {
    kinds.delete("fried_snack");
  }

  if (kinds.size === 0) kinds.add("general");
  return Array.from(kinds);
}

const GROUPS: Record<string, QuickNoteGroup> = {
  sugar: { id: "sugar", label: "Gula", exclusive: true, options: ["Normal Sugar", "Less Sugar", "No Sugar", "Extra Sweet"] },
  ice: { id: "ice", label: "Es", exclusive: true, options: ["Normal Ice", "Less Ice", "No Ice", "Extra Ice"] },
  temp: { id: "temp", label: "Suhu", exclusive: true, options: ["Iced", "Hot", "Warm"] },
  coffee_extra: { id: "coffee_extra", label: "Ekstra", exclusive: false, options: ["Extra Shot", "Strong", "Less Milk", "Oat Milk"] },
  tea_extra: { id: "tea_extra", label: "Ekstra", exclusive: false, options: ["Tawar", "Teh Kental", "Tambah Lemon"] },
  milk_extra: { id: "milk_extra", label: "Topping", exclusive: false, options: ["Extra Boba", "Extra Cream", "Tanpa Cream", "Extra Topping"] },
  juice_extra: { id: "juice_extra", label: "Request", exclusive: false, options: ["Tanpa Susu", "Tanpa Ampas", "Extra Kental"] },
  spicy: { id: "spicy", label: "Pedas", exclusive: true, options: ["Tidak Pedas", "Sedang", "Pedas", "Extra Pedas"] },
  food_custom: { id: "food_custom", label: "Request", exclusive: false, options: ["Tanpa Bawang", "Tanpa Sayur", "Sambal Pisah", "Nasi Sedikit"] },
  doneness: { id: "doneness", label: "Kematangan", exclusive: true, options: ["Well Done", "Medium Well", "Medium"] },
  egg: { id: "egg", label: "Telur", exclusive: true, options: ["Telur Matang", "Telur Setengah Matang", "Tanpa Telur"] },
  snack_sauce: { id: "snack_sauce", label: "Saus", exclusive: false, options: ["Saus Sambal", "Saus Tomat", "Mayonaise", "Saus Dipisah"] },
  snack_custom: { id: "snack_custom", label: "Bumbu", exclusive: false, options: ["Extra Crispy", "Tanpa Garam", "Bumbu Balado", "Bumbu Keju"] },
  bread_custom: { id: "bread_custom", label: "Penyajian", exclusive: false, options: ["Dihangatkan", "Dipotong Dua", "Extra Selai", "Tanpa Mentega"] },
  dessert_custom: { id: "dessert_custom", label: "Request", exclusive: false, options: ["Less Sweet", "Extra Topping", "Tanpa Kacang"] },
  soup_custom: { id: "soup_custom", label: "Kuah", exclusive: false, options: ["Kuah Dipisah", "Extra Kuah", "Tanpa Seledri", "Tanpa Bawang"] },
  packaging: { id: "packaging", label: "Kemasan", exclusive: false, options: ["Bungkus Terpisah", "Tambah Sendok", "Tanpa Sedotan"] },
  general: { id: "general", label: "Request", exclusive: false, options: ["Porsi Sedikit", "Tanpa Bawang", "Dipisah"] },
};

const KIND_GROUPS: Record<MenuKind, string[]> = {
  coffee: ["temp", "sugar", "ice", "coffee_extra"],
  tea: ["temp", "sugar", "ice", "tea_extra"],
  milk: ["sugar", "ice", "milk_extra"],
  juice: ["sugar", "ice", "juice_extra"],
  spicy_food: ["spicy", "food_custom"],
  rice_noodle: ["spicy", "food_custom", "egg"],
  fried_snack: ["snack_sauce", "snack_custom"],
  bread_pastry: ["bread_custom"],
  dessert: ["dessert_custom"],
  soup: ["spicy", "soup_custom"],
  general: ["general"],
};

/**
 * Hasilkan daftar grup chip rekomendasi untuk satu menu.
 * @param includePackaging tambahkan grup penyajian (dipakai untuk pesanan takeaway)
 */
export function getQuickNoteGroups(
  product: ProductLike,
  categoryName?: string | null,
  includePackaging = false
): QuickNoteGroup[] {
  const kinds = detectKinds(product, categoryName);
  const ids: string[] = [];
  kinds.forEach((k) =>
    KIND_GROUPS[k].forEach((g) => {
      if (!ids.includes(g)) ids.push(g);
    })
  );

  const text = `${product.name} ${product.description ?? ""}`.toLowerCase();

  // Menu steak / daging panggang → utamakan tingkat kematangan
  if (includesAny(text, ["steak", "sirloin", "tenderloin", "wagyu", "rib eye", "ribeye"])) {
    if (!ids.includes("doneness")) ids.unshift("doneness");
  }
  // Grup telur hanya relevan untuk menu yang memang memakai telur
  if (ids.includes("egg") && !includesAny(text, ["telur", "egg", "nasi goreng", "mie goreng", "indomie", "omelet", "omelette", "ceplok", "dadar"])) {
    ids.splice(ids.indexOf("egg"), 1);
  }
  // Minuman yang sudah jelas panas/dingin tidak perlu grup suhu
  if (ids.includes("temp") && /\b(iced|ice|es|cold|frappe|hot|panas|hangat)\b/.test(text)) {
    ids.splice(ids.indexOf("temp"), 1);
  }
  // Minuman panas tidak perlu grup es
  if (ids.includes("ice") && /\b(hot|panas|hangat)\b/.test(text)) {
    ids.splice(ids.indexOf("ice"), 1);
  }

  if (includePackaging && !ids.includes("packaging")) ids.push("packaging");

  return ids.map((id) => GROUPS[id]).filter(Boolean);
}

/** Pecah teks catatan menjadi token (dipisah koma). */
export function splitNoteTokens(notes: string): string[] {
  return (notes || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cek apakah sebuah opsi chip sedang aktif di dalam teks catatan. */
export function isQuickNoteActive(notes: string, option: string): boolean {
  const target = option.toLowerCase();
  return splitNoteTokens(notes).some((t) => t.toLowerCase() === target);
}

/**
 * Toggle opsi chip di dalam teks catatan.
 * - Jika grup eksklusif, opsi lain dalam grup yang sama otomatis dilepas.
 * - Teks catatan bebas yang diketik pelanggan tetap dipertahankan.
 */
export function toggleQuickNote(notes: string, option: string, group?: QuickNoteGroup): string {
  const tokens = splitNoteTokens(notes);
  const lower = option.toLowerCase();
  const isActive = tokens.some((t) => t.toLowerCase() === lower);

  let next: string[];
  if (isActive) {
    next = tokens.filter((t) => t.toLowerCase() !== lower);
  } else {
    const siblings = group?.exclusive ? group.options.map((o) => o.toLowerCase()) : [];
    next = tokens.filter((t) => !siblings.includes(t.toLowerCase()));
    next.push(option);
  }
  return next.join(", ");
}
