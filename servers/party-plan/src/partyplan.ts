/**
 * PartyPlan engine - party budget allocation, headcount and quantity planning,
 * a dated countdown timeline and venue-aware checklists.
 * Pure computation; money is handled in cents to avoid float drift.
 */

export type PartyStyle = "budget" | "standard" | "premium";

const round2 = (n: number) => Math.round(n * 100) / 100;
const toCents = (n: number) => Math.round(n * 100);
/** Round up to a whole item count, immune to float noise (e.g. 22.99999999 -> 23). */
const ceilUnits = (n: number) => Math.ceil(n - 1e-9);

/* --------------------------------------------------------------- budget -- */

interface BudgetCategory {
  key: string;
  tips: string;
}

const CATEGORIES: BudgetCategory[] = [
  { key: "venue", tips: "Compare 2-3 venues or a cleared room at home; weekday and Sunday slots cost the least." },
  { key: "food_drink", tips: "The biggest lever: buffet over plated service, and set drink limits instead of an open bar." },
  { key: "cake", tips: "One tier per 25-30 slices; a decorated sheet cake feeds more people per dollar than a tall tier." },
  { key: "decorations", tips: "Reuse or borrow, then buy 2-3 colors of balloons, garland and one photo backdrop." },
  { key: "entertainment", tips: "A curated playlist plus two group games beats a DJ for value; hire live acts for the peak 2 hours only." },
  { key: "favors", tips: "Keep favors under USD 3 per guest; edible or useful beats plastic trinkets." },
  { key: "contingency", tips: "Hold this for delivery fees, extra ice, taxes and last-minute top-ups." },
];

/** Percent bands per style, in CATEGORIES order. Each row sums to 100. */
const STYLE_SPLIT: Record<PartyStyle, number[]> = {
  budget: [15, 35, 7, 8, 10, 5, 20],
  standard: [25, 30, 8, 10, 12, 8, 7],
  premium: [30, 28, 7, 12, 15, 5, 3],
};

export interface PartyBudgetInput {
  budget: number;
  guests: number;
  style?: PartyStyle;
}

export function partyBudget(input: PartyBudgetInput): object {
  if (!Number.isFinite(input.budget) || input.budget <= 0) {
    throw new Error(`budget must be a positive number in USD (e.g. 600); got ${input.budget}.`);
  }
  if (!Number.isInteger(input.guests) || input.guests < 1 || input.guests > 500) {
    throw new Error(`guests must be a whole number between 1 and 500; got ${input.guests}.`);
  }
  const style = input.style ?? "standard";
  if (!(style in STYLE_SPLIT)) {
    throw new Error(`style must be "budget", "standard" or "premium"; got "${String(input.style)}".`);
  }

  const budgetCents = toCents(input.budget);
  const percents = STYLE_SPLIT[style];
  const amounts = percents.map((p) => Math.round((budgetCents * p) / 100));
  // Rounding drift stays inside the budget: contingency absorbs the leftover cents.
  amounts[amounts.length - 1] += budgetCents - amounts.reduce((a, b) => a + b, 0);
  const perGuestCents = Math.round(budgetCents / input.guests);

  const allocation = CATEGORIES.map((c, i) => ({
    category: c.key,
    percent: percents[i],
    amount: amounts[i] / 100,
    tips: c.tips,
  }));

  return {
    currency: "USD",
    budget: round2(budgetCents / 100),
    guests: input.guests,
    per_guest_budget: round2(perGuestCents / 100),
    allocation,
    note: `"${style}" style splits USD ${(budgetCents / 100).toFixed(2)} across ${allocation.length} categories for ${input.guests} guests (about USD ${(perGuestCents / 100).toFixed(2)} per guest). Contingency keeps the rounding remainder.`,
  };
}

/* ------------------------------------------------------------ headcount -- */

export interface HeadcountInput {
  invited: number;
  expected_decline_pct?: number;
  children_pct?: number;
}

export function headcountPlan(input: HeadcountInput): object {
  if (!Number.isInteger(input.invited) || input.invited < 1 || input.invited > 1000) {
    throw new Error(`invited must be a whole number between 1 and 1000; got ${input.invited}.`);
  }
  const declinePct = input.expected_decline_pct ?? 15;
  if (!Number.isFinite(declinePct) || declinePct < 0 || declinePct > 100) {
    throw new Error(`expected_decline_pct must be a number between 0 and 100 (default 15); got ${declinePct}.`);
  }
  const childrenPct = input.children_pct ?? 0;
  if (!Number.isFinite(childrenPct) || childrenPct < 0 || childrenPct > 100) {
    throw new Error(`children_pct must be a number between 0 and 100 (default 0); got ${childrenPct}.`);
  }

  const expected = Math.ceil((input.invited * (100 - declinePct)) / 100);
  const children = Math.round((expected * childrenPct) / 100);
  const adults = expected - children;

  const quantities = {
    mains_portions: ceilUnits(adults * 1.15 + children * 0.75),
    drinks: ceilUnits(adults * 2.5 + children * 1.5),
    cake_slices: ceilUnits(expected * 1.2),
    favors: ceilUnits(expected * 1.1),
    plates: ceilUnits(expected * 1.25),
  };

  return {
    invited: input.invited,
    expected_attendees: expected,
    adults,
    children,
    quantities,
    note: `${input.invited} invited with ${declinePct}% expected decline gives ${expected} attendees (${adults} adults, ${children} children). Quantities add standard buffers: 15% extra mains, 2.5 drinks per adult, 20% extra cake slices, 10% extra favors and 25% extra plates.`,
  };
}

/* ------------------------------------------------------------- timeline -- */

export interface TimelineInput {
  event_date: string;
  event_type?: string;
  guests?: number;
}

const OFFSETS = [42, 28, 21, 14, 7, 3, 1, 0] as const;

const BASE_TASKS: Record<number, string[]> = {
  42: [
    "Set the date, start time and total budget; write it where co-hosts can see it.",
    "Choose the venue (or confirm home) and check availability for the date.",
    "Book the venue, hall or party room - popular dates go months ahead.",
    "Draft the guest list and decide who gets invited first.",
  ],
  28: [
    "Send invitations or save-the-dates with a clear RSVP deadline.",
    "Book entertainment (DJ, band, magician, bouncy castle) before the best ones are gone.",
    "Collect 2-3 catering quotes or drop-off menus and compare per-head prices.",
    "Pick the theme and 2-3 colors for decorations.",
  ],
  21: [
    "Chase the first RSVP replies and update the headcount.",
    "Book the cake baker and lock the design.",
    "Reserve rentals: tables, chairs, linens, marquee or bouncy castle.",
    "Confirm the menu and collect allergies and dietary needs.",
  ],
  14: [
    "Finalize the menu and order the cake against the current headcount.",
    "Buy or order decorations and favors.",
    "Confirm entertainment timings and any equipment it needs.",
    "Build the playlist and plan two group games.",
  ],
  7: [
    "Ask guests to confirm final attendance and chase missing RSVPs.",
    "Confirm final numbers with the caterer, venue or helper cooks.",
    "Buy non-perishables, drinks and paper goods.",
    "Print or prepare games, activity sheets and name tags.",
    "Assign day-of jobs to helpers: setup, photos, cake, cleanup.",
  ],
  3: [
    "Do the main grocery run: perishables, ice and fresh drinks.",
    "Confirm cake pickup or delivery time.",
    "Cook and refrigerate or freeze make-ahead dishes.",
    "Charge speakers, camera and phones; download the playlist offline.",
    "Clean and clear the party space; sort coat and shoe space.",
  ],
  1: [
    "Set up tables, chairs and decorations; leave the food tables empty for now.",
    "Chill drinks and fill coolers; keep ice in the freezer until the last minute.",
    "Prep make-ahead food and label allergens.",
    "Confirm cake pickup and entertainment arrival times.",
    "Print the run sheet: timings, contacts and who does what.",
  ],
  0: [
    "Pick up the cake and ice; set out food and drinks.",
    "Final setup: music on, candles ready, photo spot lit.",
    "Greet guests, take photos and start the food when the first wave arrives.",
    "Run the cake and candles moment, then group photos.",
    "Pack leftovers, hand out favors and return rentals.",
  ],
};

function parseEventDate(value: string): { iso: string; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`event_date must be a calendar date in YYYY-MM-DD format (e.g. 2026-12-20); got "${value}".`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`event_date "${value}" is not a real calendar date (check the month and day).`);
  }
  return { iso: `${match[1]}-${match[2]}-${match[3]}`, day: date.getTime() };
}

function shiftDays(time: number, days: number): string {
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

export function partyTimeline(input: TimelineInput): object {
  const { iso, day } = parseEventDate(input.event_date);
  if (input.guests !== undefined && (!Number.isInteger(input.guests) || input.guests < 1 || input.guests > 1000)) {
    throw new Error(`guests must be a whole number between 1 and 1000; got ${input.guests}.`);
  }

  const milestones = OFFSETS.map((offset) => {
    const tasks = [...BASE_TASKS[offset]];
    if (offset === 21 && input.event_type) {
      tasks.push(`Confirm ${input.event_type} specifics: supplier, delivery, setup and pack-down times.`);
    }
    if (offset === 14 && input.guests !== undefined) {
      tasks.push(`Order the cake for about ${input.guests} guests (roughly one tier per 25 slices).`);
    }
    return { when: `T-${offset} days`, date: shiftDays(day, -offset), tasks };
  });

  return {
    event_date: iso,
    milestones,
    note: "The date on each milestone is the calendar day to finish those tasks by; work back from the event date and shift anything that lands on a weekend of errands.",
  };
}

/* ------------------------------------------------------------ checklist -- */

export type ChecklistVenue = "home" | "venue";

export interface ChecklistInput {
  venue: ChecklistVenue;
  extras?: string[];
}

type Area = "food_drink" | "decorations" | "music_activities" | "practical" | "safety";

const AREAS: Area[] = ["food_drink", "decorations", "music_activities", "practical", "safety"];

const CHECKLIST: Record<Area, { common: string[]; home: string[]; venue: string[] }> = {
  food_drink: {
    common: [
      "Confirm the final headcount and collect dietary needs and allergies.",
      "Plan the menu: 2 mains, 2 sides, 1 dessert, plus the cake.",
      "Shop for drinks: about 2.5 per adult and 1.5 per child, plus plenty of water.",
      "Order or bake the cake to the final headcount.",
      "Prep serving platters, labels and allergen notes.",
    ],
    home: [
      "Clear fridge and freezer space for food and drinks.",
      "Cook or prep make-ahead dishes the day before.",
      "Set out coolers or tubs for ice and cold drinks.",
    ],
    venue: [
      "Confirm the venue's catering, corkage and outside-food rules.",
      "Check kitchen access: power points, prep space, fridges and sinks.",
      "Confirm vendor delivery windows, access doors and parking.",
    ],
  },
  decorations: {
    common: [
      "Pick the theme and 2-3 colors; keep every prop in that palette.",
      "Balloons or garlands for the entry and the photo spot.",
      "Table covers, plates, napkins and cutlery with 25% spare.",
      "Candles, matches and a cake knife.",
      "String lights or lamps to warm up the room after dark.",
    ],
    home: [
      "Clear breakables and personal items from the party areas.",
      "Put away or cover furniture and rugs you want protected.",
    ],
    venue: [
      "Ask what is already included: tables, linens, lighting, backdrop.",
      "Check where decorations may be hung or taped (damage fees).",
    ],
  },
  music_activities: {
    common: [
      "Build a 2-3 hour playlist: warm-up, dance floor, wind-down.",
      "Charge the speaker and test Bluetooth, microphone and volume.",
      "Plan two group games (trivia, karaoke, treasure hunt, musical chairs).",
      "Set up a quiet corner with toys or seats for kids and older guests.",
    ],
    home: [
      "Warn neighbours about noise and agree a quiet hour with the household.",
    ],
    venue: [
      "Ask the venue about the sound system, microphone and noise curfew.",
      "Confirm activity setup and pack-down windows with venue staff.",
    ],
  },
  practical: {
    common: [
      "Trash bags and clearly marked recycling bins.",
      "Serving spoons, tongs, bottle opener, corkscrew and extra scissors.",
      "Ice: roughly 1 bag per 5 guests, plus one spare.",
      "Paper towels, wet wipes and stain remover.",
      "First-aid kit, phone chargers and a power strip.",
    ],
    home: [
      "Deep-clean the guest bathroom; stock toilet paper, soap and towels.",
      "Clear the entry for shoes and coats and put down a mat.",
      "Set up a kids' play area away from the food and stairs.",
    ],
    venue: [
      "Confirm the booking slot, deposit and the venue contact for the day.",
      "Ask for the room layout or floor plan and note the setup time.",
      "Test AV: screen, projector, HDMI adapters and microphone batteries.",
      "Share parking, entrance and accessibility details with guests.",
    ],
  },
  safety: {
    common: [
      "Collect allergy info and label every dish; keep a list of who has what.",
      "Keep alcohol out of reach of kids and plan safe rides home.",
      "Secure cables, clear trip hazards and keep glass off the dance floor.",
      "Write down who is supervising children and swap duties every hour.",
      "Check smoke alarms and keep candles away from decorations.",
    ],
    home: [
      "Move cleaning products, medicines and sharp tools out of reach.",
      "Plan for pets: secure them in a quiet room away from the party.",
      "If there is a pool, pond or stairs, set a hard boundary for kids.",
    ],
    venue: [
      "Ask venue staff about first-aid, emergency exits and the evacuation point.",
      "Confirm the venue's insurance covers your activities (bouncy castles, DJ).",
      "Note the nearest hospital and keep a charged phone for emergencies.",
    ],
  },
};

const EXTRA_RULES: Array<{ label: string; keys: string[]; items: Partial<Record<Area, string[]>> }> = [
  {
    label: "pool",
    keys: ["pool", "swimming"],
    items: {
      practical: ["Pool kit: towels, dry bag, rescue ring and a reach pole."],
      safety: [
        "Pool safety: a designated adult watches the water at all times; test the water and put the ladder away afterwards.",
      ],
    },
  },
  {
    label: "bbq",
    keys: ["bbq", "barbecue", "barbeque", "grill"],
    items: {
      food_drink: ["Plan BBQ sides that hold: slaw, corn, salads and buns."],
      practical: ["BBQ kit: fuel or coals, lighter, long tongs, thermometer and a drip tray."],
      safety: ["BBQ safety: set the grill away from kids, curtains and plants, and never leave it lit unattended."],
    },
  },
  {
    label: "costume",
    keys: ["costume", "halloween"],
    items: {
      decorations: ["Costume corner: prize for best dressed and a photo backdrop."],
      practical: ["Mirror and steamer by the door for last-minute costume fixes."],
      safety: ["Costume safety: masks must not block vision; keep long costumes off stairs and candles."],
    },
  },
  {
    label: "outdoor",
    keys: ["outdoor", "outside", "garden", "backyard"],
    items: {
      practical: ["Outdoor kit: canopy or shade, sun cream, bug spray, ground mats and spare shoes."],
      safety: ["Outdoor safety: secure loose decorations against wind and agree a wet-weather plan B indoors."],
    },
  },
  {
    label: "kids",
    keys: ["kids", "children"],
    items: {
      food_drink: ["Kids' menu: smaller portions, no-fuss finger food and spill-proof cups."],
      music_activities: ["Kids' zone: age-appropriate games, coloring and a calm-down corner."],
      safety: ["Kids' safety: count heads at arrival, food and cake, and keep small parts and candles high up."],
    },
  },
  {
    label: "alcohol",
    keys: ["alcohol", "cocktail", "beer", "wine", "champagne", "open bar"],
    items: {
      food_drink: ["Bar plan: measured spirits, plenty of water and a non-alcoholic option."],
      practical: ["Bar kit: ice buckets, bottle opener, glasses and a bus tray."],
      safety: ["Alcohol safety: stop serving well before the end, offer water and arrange rides or a sleepover plan."],
    },
  },
  {
    label: "potluck",
    keys: ["potluck"],
    items: {
      food_drink: ["Potluck sign-up sheet by dish type so you don't end up with five salads."],
      practical: ["Extra serving spoons and labels for potluck dishes (name plus allergens)."],
    },
  },
];

/** Word-boundary match so "pool party" matches pool but "pool table" does not. */
function matches(text: string, key: string): boolean {
  if (!text.includes(key)) return false;
  if (key === "pool" && (text.includes("pool table") || text.includes("billiard"))) return false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(text);
}

export function partyChecklist(input: ChecklistInput): object {
  if (input.venue !== "home" && input.venue !== "venue") {
    throw new Error(`venue must be "home" or "venue"; got "${String(input.venue)}".`);
  }
  const extras = input.extras ?? [];
  if (!Array.isArray(extras)) {
    throw new Error("extras must be a list of keywords such as [\"pool\", \"bbq\"].");
  }
  for (const extra of extras) {
    if (typeof extra !== "string" || !extra.trim()) {
      throw new Error("every extras entry must be a non-empty keyword, e.g. \"pool\", \"bbq\", \"costume\", \"outdoor\".");
    }
  }

  const additions: Record<Area, string[]> = {
    food_drink: [],
    decorations: [],
    music_activities: [],
    practical: [],
    safety: [],
  };
  const applied: string[] = [];
  for (const extra of extras) {
    const text = extra.toLowerCase();
    for (const rule of EXTRA_RULES) {
      if (applied.includes(rule.label)) continue;
      if (rule.keys.some((key) => matches(text, key))) {
        applied.push(rule.label);
        for (const area of AREAS) {
          additions[area].push(...(rule.items[area] ?? []));
        }
      }
    }
  }

  const checklist = AREAS.map((area) => ({
    area,
    items: [...CHECKLIST[area].common, ...CHECKLIST[area][input.venue], ...additions[area]],
  }));

  const extrasNote =
    applied.length > 0
      ? `Extras applied: ${applied.join(", ")}.`
      : "No extras matched; add keywords like pool, bbq, costume, outdoor, kids, alcohol or potluck for more items.";

  return {
    venue: input.venue,
    checklist,
    note:
      (input.venue === "home"
        ? "Home party: includes cooking, cleaning and kid-supervision items."
        : "Venue party: cleaning and cooking tasks dropped; booking, vendor access and AV checks added.") +
      ` ${extrasNote}`,
  };
}
