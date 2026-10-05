/**
 * RecipeScale engine - kitchen math for recipes and shopping lists:
 * scale ingredient amounts, convert cooking units (volume <-> weight via
 * ingredient densities), merge shopping lists and work out cost per serving.
 * Pure computation: no dependencies, no network, nothing stored.
 */

export type Dimension = "volume" | "weight" | "count";

interface UnitDef {
  dimension: Dimension;
  base: number; // ml for volume, g for weight, 1 for count
  plural?: string;
}

const CUP_ML = 236.588;

const UNITS: Record<string, UnitDef> = {
  tsp: { dimension: "volume", base: 4.929 },
  tbsp: { dimension: "volume", base: 14.787 },
  cup: { dimension: "volume", base: CUP_ML, plural: "cups" },
  fl_oz: { dimension: "volume", base: 29.574 },
  ml: { dimension: "volume", base: 1 },
  l: { dimension: "volume", base: 1000 },
  pint: { dimension: "volume", base: 473.176, plural: "pints" },
  quart: { dimension: "volume", base: 946.353, plural: "quarts" },
  gallon: { dimension: "volume", base: 3785.41, plural: "gallons" },
  g: { dimension: "weight", base: 1 },
  kg: { dimension: "weight", base: 1000 },
  oz: { dimension: "weight", base: 28.3495 },
  lb: { dimension: "weight", base: 453.592 },
  each: { dimension: "count", base: 1 },
};

// Everyday spellings that map onto the canonical cooking units above.
const UNIT_ALIASES: Record<string, string> = {
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp", tbsps: "tbsp",
  cup: "cup", cups: "cup",
  "fl oz": "fl_oz", fl_oz: "fl_oz", floz: "fl_oz", "fluid ounce": "fl_oz", "fluid ounces": "fl_oz",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  pint: "pint", pints: "pint",
  quart: "quart", quarts: "quart",
  gallon: "gallon", gallons: "gallon",
  g: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg", kilo: "kg", kilos: "kg",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  each: "each", ea: "each", unit: "each", units: "each", piece: "each", pieces: "each", pc: "each", pcs: "each", whole: "each",
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Rounds to `digits` significant digits (e.g. 236.588 -> 236.6 at 4). */
function roundSig(n: number, digits: number): number {
  if (n === 0 || !Number.isFinite(n)) return n;
  const power = digits - Math.ceil(Math.log10(Math.abs(n)));
  const mag = Math.pow(10, power);
  return Math.round(n * mag) / mag;
}

const trim = (n: number): string => String(round2(n));

/** Plain "<amount> <unit>" rendering used for conversion displays. */
const plain = (value: number, unit: string): string => {
  const label = unitLabel(value, unit);
  return label ? `${trim(value)} ${label}` : trim(value);
};

const norm = (s: string): string => s.trim().toLowerCase().replace(/\./g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ");

const UNIT_LOOKUP: Record<string, string> = {};
for (const [alias, canonical] of Object.entries(UNIT_ALIASES)) UNIT_LOOKUP[norm(alias)] = canonical;

function resolveUnit(raw: string): string | null {
  const key = norm(raw);
  return key ? UNIT_LOOKUP[key] ?? null : null;
}

const DENSITY_G_PER_CUP: Record<string, number> = {
  flour: 125,
  sugar: 200,
  "brown sugar": 220,
  butter: 227,
  water: 236,
  milk: 244,
  rice: 185,
  oats: 90,
  cocoa: 85,
  honey: 340,
};

const KNOWN_INGREDIENTS = "flour, sugar, brown sugar, butter, water, milk, rice, oats, cocoa, honey";
const KNOWN_INGREDIENTS_LIST = Object.keys(DENSITY_G_PER_CUP);

/** Maps "all-purpose flour" / "brown_sugar" onto a density-table ingredient. */
function findIngredient(raw: string): string | null {
  const key = norm(raw);
  if (!key) return null;
  if (DENSITY_G_PER_CUP[key] !== undefined) return key;
  for (const candidate of [...KNOWN_INGREDIENTS_LIST].sort((a, b) => b.length - a.length)) {
    if (key.includes(candidate)) return candidate;
  }
  return null;
}

const SUPPORTED_UNITS = (() => {
  const by: Record<Dimension, string[]> = { volume: [], weight: [], count: [] };
  for (const [unit, def] of Object.entries(UNITS)) by[def.dimension].push(unit);
  return `${by.volume.join(", ")} (volume); ${by.weight.join(", ")} (weight); ${by.count.join(", ")} (count)`;
})();

const FRACTIONS: Array<{ value: number; label: string }> = [
  { value: 0.25, label: "1/4" },
  { value: 0.33, label: "1/3" },
  { value: 0.5, label: "1/2" },
  { value: 0.66, label: "2/3" },
  { value: 0.75, label: "3/4" },
];

/** "cup" -> "cups" when there is more than one; free labels pluralise too. */
function unitLabel(qty: number, unit?: string): string {
  if (!unit) return "";
  const def = UNITS[unit];
  if (def) return qty > 1 ? def.plural ?? unit : unit;
  if (qty > 1) return unit.endsWith("s") ? unit : `${unit}s`;
  return unit.endsWith("s") && !unit.endsWith("ss") && unit.length > 3 ? unit.slice(0, -1) : unit;
}

/**
 * Friendly kitchen formatting: 2 decimals max, plus a fraction hint for the
 * common measures, e.g. 1.5 -> "1 1/2 cups (1.5)".
 */
function formatQty(value: number, unit?: string): string {
  const v = round2(value);
  const whole = Math.floor(v + 1e-9);
  const frac = round2(v - whole);
  const hint = FRACTIONS.find((f) => Math.abs(frac - f.value) <= 0.015 && frac > 0);
  const label = unitLabel(v, unit);
  const suffix = label ? ` ${label}` : "";
  if (hint) {
    const mixed = whole > 0 ? `${whole} ${hint.label}` : hint.label;
    return `${mixed}${suffix} (${trim(v)})`;
  }
  return `${trim(v)}${suffix}`;
}

// ---------------------------------------------------------------------------
// 1. scale_recipe
// ---------------------------------------------------------------------------

export interface ScaleIngredient {
  quantity?: number;
  unit?: string;
  item: string;
  note?: string;
}

export interface ScaleRecipeInput {
  ingredients: ScaleIngredient[];
  from_servings: number;
  to_servings: number;
}

export function scaleRecipe(input: ScaleRecipeInput): object {
  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) {
    throw new Error("ingredients must be a non-empty list of {item, quantity?, unit?} - add at least one ingredient.");
  }
  const from = input.from_servings;
  const to = input.to_servings;
  if (!Number.isFinite(from) || from <= 0) throw new Error("from_servings must be a positive number (the servings the recipe is written for).");
  if (!Number.isFinite(to) || to <= 0) throw new Error("to_servings must be a positive number (the servings you want).");
  const factor = to / from;
  if (factor < 0.1 || factor > 20) {
    throw new Error(`scaling factor ${trim(factor)}x is outside the supported 0.1x-20x range; adjust from_servings (${trim(from)}) or to_servings (${trim(to)}).`);
  }

  const ingredients = input.ingredients.map((ing, i) => {
    if (!ing || typeof ing.item !== "string" || !ing.item.trim()) {
      throw new Error(`ingredient ${i + 1}: 'item' must be a non-empty name.`);
    }
    const item = ing.item.trim();
    const note = typeof ing.note === "string" && ing.note.trim() ? ing.note.trim() : undefined;

    if (ing.quantity === undefined) {
      const passthrough = note ?? "as needed";
      return { item, original: passthrough, scaled: null, scaled_display: passthrough, scaled_flag: false };
    }
    if (typeof ing.quantity !== "number" || !Number.isFinite(ing.quantity) || ing.quantity < 0) {
      throw new Error(`ingredient '${item}': quantity must be a non-negative number, or omit it for 'to taste' items.`);
    }
    const rawUnit = typeof ing.unit === "string" && ing.unit.trim() ? norm(ing.unit) : undefined;
    const unit = rawUnit ? resolveUnit(rawUnit) ?? rawUnit : undefined;
    const scaledRaw = ing.quantity * factor;
    return {
      item,
      original: formatQty(ing.quantity, unit),
      scaled: round2(scaledRaw),
      scaled_display: formatQty(scaledRaw, unit),
      scaled_flag: true,
    };
  });

  return {
    from_servings: from,
    to_servings: to,
    factor: roundSig(factor, 4),
    ingredients,
    note: `Scaled from ${trim(from)} to ${trim(to)} servings (x${trim(factor)}). Fraction hints show the closest common kitchen measure; ingredients submitted without a quantity are passed through unchanged.`,
  };
}

// ---------------------------------------------------------------------------
// 2. convert_units
// ---------------------------------------------------------------------------

export interface ConvertUnitsInput {
  value: number;
  from: string;
  to: string;
  ingredient?: string;
}

export function convertUnits(input: ConvertUnitsInput): object {
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) throw new Error("value must be a number to convert.");
  if (input.value < 0) throw new Error("value must be zero or positive; negative kitchen amounts cannot be converted.");
  const from = resolveUnit(input.from ?? "");
  if (!from) throw new Error(`unknown unit '${input.from}'. Supported units: ${SUPPORTED_UNITS}.`);
  const to = resolveUnit(input.to ?? "");
  if (!to) throw new Error(`unknown unit '${input.to}'. Supported units: ${SUPPORTED_UNITS}.`);

  const fromDef = UNITS[from];
  const toDef = UNITS[to];
  const value = input.value;

  if (fromDef.dimension === toDef.dimension) {
    const result = roundSig((value * fromDef.base) / toDef.base, 4);
    return {
      value,
      from,
      to,
      result,
      display: `${plain(value, from)} = ${plain(result, to)}`,
      method: "linear",
    };
  }

  const crossDimension = (fromDef.dimension === "volume" && toDef.dimension === "weight") || (fromDef.dimension === "weight" && toDef.dimension === "volume");
  if (!crossDimension) {
    throw new Error(`cannot convert ${fromDef.dimension} to ${toDef.dimension} directly. Supported units: ${SUPPORTED_UNITS}.`);
  }

  const ingredientKey = typeof input.ingredient === "string" && input.ingredient.trim() ? findIngredient(input.ingredient) : null;
  if (!ingredientKey) {
    throw new Error(
      `converting ${fromDef.dimension} to ${toDef.dimension} needs a known ingredient density; '${input.ingredient ?? "(none)"}' is not in the table. ` +
        `Known ingredients: ${KNOWN_INGREDIENTS}. Retry with ingredient set to one of these, or convert within one dimension.`,
    );
  }
  const density = DENSITY_G_PER_CUP[ingredientKey];
  const base = value * fromDef.base; // ml when converting from volume, g when converting from weight
  const converted = fromDef.dimension === "volume" ? (base * density) / CUP_ML : (base * CUP_ML) / density;
  const result = roundSig(converted / toDef.base, 4);
  return {
    value,
    from,
    to,
    result,
    display: `${plain(value, from)} ${ingredientKey} = ${plain(result, to)} (approx.)`,
    method: "density",
    density_note: `${ingredientKey}: ${density} g per cup (1 cup = ${CUP_ML} ml), so this is an approximate kitchen conversion.`,
  };
}

// ---------------------------------------------------------------------------
// 3. merge_shopping_list
// ---------------------------------------------------------------------------

export interface MergeItem {
  quantity?: number;
  unit?: string;
  item: string;
}

export interface ShoppingList {
  name?: string;
  items: MergeItem[];
}

export interface MergeShoppingListInput {
  lists: ShoppingList[];
}

interface Accumulator {
  item: string;
  kind: "volume" | "weight" | "count" | "label";
  label?: string;
  baseTotal: number; // tsp for volume, g for weight, 1 for counts
  fromLists: string[];
}

/** Picks the friendliest display unit for a summed volume/weight total. */
function friendlyVolume(totalTsp: number): { quantity: number; unit: string } {
  const ml = totalTsp * 4.929;
  if (ml >= 1000) return { quantity: round2(ml / 1000), unit: "l" };
  if (totalTsp >= 3) {
    const cups = totalTsp / 48;
    if (Math.abs(cups * 4 - Math.round(cups * 4)) <= 0.02) return { quantity: round2(cups), unit: "cup" };
    const tbsp = totalTsp / 3;
    if (Math.abs(tbsp - Math.round(tbsp)) <= 0.02) return { quantity: round2(tbsp), unit: "tbsp" };
  }
  return { quantity: round2(totalTsp), unit: "tsp" };
}

function friendlyWeight(totalG: number): { quantity: number; unit: string } {
  if (totalG >= 1000) return { quantity: round2(totalG / 1000), unit: "kg" };
  return { quantity: round2(totalG), unit: "g" };
}

export function mergeShoppingList(input: MergeShoppingListInput): object {
  if (!Array.isArray(input.lists) || input.lists.length === 0) {
    throw new Error("lists must be a non-empty array of {name?, items:[{item, quantity?, unit?}]} shopping lists.");
  }

  const groups = new Map<string, Accumulator>();
  const skipped = new Map<string, { name: string; fromLists: string[] }>();
  let itemCount = 0;

  input.lists.forEach((list, li) => {
    if (!list || !Array.isArray(list.items)) throw new Error(`list ${li + 1}: items must be an array of {item, quantity?, unit?}.`);
    const listName = typeof list.name === "string" && list.name.trim() ? list.name.trim() : `list ${li + 1}`;

    for (const entry of list.items) {
      if (!entry || typeof entry.item !== "string" || !entry.item.trim()) {
        throw new Error(`list ${li + 1}: every item needs a non-empty 'item' name.`);
      }
      const name = entry.item.trim();
      itemCount += 1;

      if (entry.quantity === undefined) {
        const key = norm(name);
        const seen = skipped.get(key) ?? { name, fromLists: [] };
        if (!seen.fromLists.includes(listName)) seen.fromLists.push(listName);
        skipped.set(key, seen);
        continue;
      }
      if (typeof entry.quantity !== "number" || !Number.isFinite(entry.quantity) || entry.quantity < 0) {
        throw new Error(`'${name}': quantity must be a non-negative number, or omit it for non-numeric items.`);
      }

      const rawUnit = typeof entry.unit === "string" && entry.unit.trim() ? norm(entry.unit) : "";
      const canonical = rawUnit ? resolveUnit(rawUnit) : "each";
      let kind: Accumulator["kind"];
      let label: string | undefined;
      let base: number;
      if (!rawUnit) {
        kind = "count";
        base = entry.quantity;
      } else if (canonical) {
        const def = UNITS[canonical];
        if (def.dimension === "volume") {
          kind = "volume";
          base = entry.quantity * (def.base / 4.929);
        } else if (def.dimension === "weight") {
          kind = "weight";
          base = entry.quantity * def.base;
        } else {
          kind = "count";
          base = entry.quantity;
        }
      } else {
        kind = "label";
        label = rawUnit;
        base = entry.quantity;
      }

      const key = `${norm(name)}::${kind}::${label ?? ""}`;
      const acc = groups.get(key) ?? { item: name, kind, label, baseTotal: 0, fromLists: [] };
      acc.baseTotal += base;
      if (!acc.fromLists.includes(listName)) acc.fromLists.push(listName);
      groups.set(key, acc);
    }
  });

  if (itemCount === 0) throw new Error("lists must contain at least one item to merge.");

  const merged = [...groups.values()].map((acc) => {
    let quantity: number;
    let unit: string;
    if (acc.kind === "volume") ({ quantity, unit } = friendlyVolume(acc.baseTotal));
    else if (acc.kind === "weight") ({ quantity, unit } = friendlyWeight(acc.baseTotal));
    else if (acc.kind === "label") ({ quantity, unit } = { quantity: round2(acc.baseTotal), unit: acc.label ?? "" });
    else ({ quantity, unit } = { quantity: round2(acc.baseTotal), unit: "each" });
    return {
      item: acc.item,
      quantity,
      unit,
      display: formatQty(quantity, unit),
      from_lists: acc.fromLists,
    };
  });

  const skipped_no_quantity = [...skipped.values()].map((s) => (s.fromLists.length > 1 ? `${s.name} (${s.fromLists.length} lists)` : s.name));

  return {
    merged,
    skipped_no_quantity,
    note:
      `Merged ${merged.length} line(s) from ${input.lists.length} list(s); ` +
      `${skipped_no_quantity.length} item(s) had no quantity and are listed as notes. ` +
      "Volume and weight amounts for the same item stay on separate lines unless converted with convert_units.",
  };
}

// ---------------------------------------------------------------------------
// 4. cost_per_serving
// ---------------------------------------------------------------------------

export interface CostIngredient {
  item: string;
  cost: number;
}

export interface CostPerServingInput {
  ingredients: CostIngredient[];
  servings: number;
  currency?: string;
}

export function costPerServing(input: CostPerServingInput): object {
  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) {
    throw new Error("ingredients must be a non-empty list of {item, cost} - add at least one priced ingredient.");
  }
  let totalCents = 0;
  for (const [i, ing] of input.ingredients.entries()) {
    if (!ing || typeof ing.item !== "string" || !ing.item.trim()) throw new Error(`ingredient ${i + 1}: 'item' must be a non-empty name.`);
    if (typeof ing.cost !== "number" || !Number.isFinite(ing.cost) || ing.cost < 0) {
      throw new Error(`'${ing.item.trim()}': cost must be a number >= 0.`);
    }
    totalCents += Math.round(ing.cost * 100);
  }
  if (typeof input.servings !== "number" || !Number.isFinite(input.servings) || input.servings <= 0) {
    throw new Error("servings must be a positive number (how many servings the recipe makes).");
  }
  const currency = typeof input.currency === "string" && input.currency.trim() ? input.currency.trim().toUpperCase() : "USD";
  const total = round2(totalCents / 100);
  const perServing = round2(total / input.servings);
  const perTen = round2(perServing * 10);

  return {
    currency,
    total_cost: total,
    servings: input.servings,
    per_serving: perServing,
    per_ten_servings: perTen,
    note: `${trim(input.servings)} serving(s) cost ${currency} ${total.toFixed(2)} in total; that is ${currency} ${perServing.toFixed(2)} per serving and ${currency} ${perTen.toFixed(2)} for 10 servings.`,
  };
}
