/**
 * CourtSplit engine - fair cost splitting, settle-up, recurring sessions and
 * rotation planning for sports courts, leagues and pickup games.
 * Pure computation; all money handled in cents to avoid float drift.
 */

export interface Participant {
  name: string;
  paid?: number;
}

export interface Balance {
  name: string;
  paid: number;
  owed: number;
  balance: number; // positive = should receive money back
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function validateParticipants(participants: Participant[]): void {
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new Error("participants must be a list of at least 2 people ({name, paid?}).");
  }
  const names = new Set<string>();
  for (const p of participants) {
    if (!p || typeof p.name !== "string" || !p.name.trim()) throw new Error("every participant needs a non-empty name.");
    if (names.has(p.name.trim())) throw new Error(`duplicate participant name '${p.name}'.`);
    names.add(p.name.trim());
    if (p.paid !== undefined && (!Number.isFinite(p.paid) || p.paid < 0)) throw new Error(`'paid' for ${p.name} must be a non-negative number.`);
  }
}

/** Splits `total` across `weights` in cents, distributing leftover cents fairly. */
function splitCents(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor((totalCents * w) / sum));
  let remainder = totalCents - shares.reduce((a, b) => a + b, 0);
  let i = 0;
  while (remainder > 0) {
    shares[i % shares.length] += 1;
    remainder -= 1;
    i += 1;
  }
  return shares;
}

function computeBalances(totalCents: number, participants: Participant[], weights?: number[]): Balance[] {
  const w = weights ?? participants.map(() => 1);
  if (weights && (weights.length !== participants.length || weights.some((x) => !Number.isFinite(x) || x <= 0))) {
    throw new Error(`shares must be ${participants.length} positive numbers (relative weights), one per participant.`);
  }
  const owedCents = splitCents(totalCents, w);
  return participants.map((p, i) => {
    const paidCents = Math.round((p.paid ?? 0) * 100);
    return {
      name: p.name.trim(),
      paid: round2(paidCents / 100),
      owed: round2(owedCents[i] / 100),
      balance: round2((paidCents - owedCents[i]) / 100),
    };
  });
}

/** Minimal-transfer settlement between creditors and debtors (greedy largest-first). */
export function minimizeTransfers(balances: Balance[]): Transfer[] {
  const creditors = balances.filter((b) => b.balance > 0.004).map((b) => ({ name: b.name, amount: b.balance })).sort((a, b) => b.amount - a.amount);
  const debtors = balances.filter((b) => b.balance < -0.004).map((b) => ({ name: b.name, amount: -b.balance })).sort((a, b) => b.amount - a.amount);
  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].amount, debtors[di].amount);
    if (amount > 0.004) transfers.push({ from: debtors[di].name, to: creditors[ci].name, amount: round2(amount) });
    creditors[ci].amount -= amount;
    debtors[di].amount -= amount;
    if (creditors[ci].amount <= 0.004) ci += 1;
    if (debtors[di].amount <= 0.004) di += 1;
  }
  return transfers;
}

export interface SplitInput {
  total_cost: number;
  participants: Participant[];
  shares?: number[];
  currency?: string;
}

export function splitCosts(input: SplitInput): object {
  if (!Number.isFinite(input.total_cost) || input.total_cost <= 0) throw new Error("total_cost must be a positive number.");
  validateParticipants(input.participants);
  const currency = input.currency ?? "USD";
  const totalCents = Math.round(input.total_cost * 100);
  const balances = computeBalances(totalCents, input.participants, input.shares);
  const perHead = input.shares ? null : round2(input.total_cost / input.participants.length);
  return {
    currency,
    total_cost: round2(input.total_cost),
    split: input.shares ? "weighted" : "equal",
    per_head: perHead,
    participants: balances,
    settle_up: minimizeTransfers(balances),
    note: perHead ? `Each of ${input.participants.length} players owes ${currency} ${perHead.toFixed(2)}.` : "Costs split by the provided relative weights.",
  };
}

export interface SettleInput {
  total_cost: number;
  participants: Participant[];
  shares?: number[];
  currency?: string;
}

export function settleUp(input: SettleInput): object {
  if (!Number.isFinite(input.total_cost) || input.total_cost <= 0) throw new Error("total_cost must be a positive number.");
  validateParticipants(input.participants);
  const balances = computeBalances(Math.round(input.total_cost * 100), input.participants, input.shares);
  const transfers = minimizeTransfers(balances);
  return {
    currency: input.currency ?? "USD",
    total_cost: round2(input.total_cost),
    balances,
    transfers,
    transfer_count: transfers.length,
    note: transfers.length === 0 ? "Everyone is settled up." : `${transfers.length} payment(s) settle the group with the fewest transfers.`,
  };
}

export interface SeriesSession {
  label?: string;
  cost: number;
  attendees: string[];
}

export interface SeriesInput {
  sessions: SeriesSession[];
  players?: string[];
  payments?: Participant[];
  currency?: string;
}

export function splitSeries(input: SeriesInput): object {
  if (!Array.isArray(input.sessions) || input.sessions.length === 0) throw new Error("sessions must be a non-empty list of {cost, attendees}.");
  const owedCents = new Map<string, number>();
  const played = new Map<string, number>();
  const sessionDetails: Array<Record<string, unknown>> = [];
  let totalCents = 0;

  input.sessions.forEach((s, idx) => {
    if (!Number.isFinite(s.cost) || s.cost <= 0) throw new Error(`session ${idx + 1}: cost must be a positive number.`);
    if (!Array.isArray(s.attendees) || s.attendees.length === 0) throw new Error(`session ${idx + 1}: attendees must be a non-empty list of names.`);
    const seen = new Set<string>();
    for (const name of s.attendees) {
      if (typeof name !== "string" || !name.trim()) throw new Error(`session ${idx + 1}: attendee names must be non-empty strings.`);
      if (seen.has(name.trim())) throw new Error(`session ${idx + 1}: duplicate attendee '${name.trim()}'.`);
      seen.add(name.trim());
    }
    const costCents = Math.round(s.cost * 100);
    totalCents += costCents;
    const shares = splitCents(costCents, s.attendees.map(() => 1));
    s.attendees.forEach((name, i) => {
      const key = name.trim();
      owedCents.set(key, (owedCents.get(key) ?? 0) + shares[i]);
      played.set(key, (played.get(key) ?? 0) + 1);
    });
    sessionDetails.push({
      label: s.label ?? `session ${idx + 1}`,
      cost: round2(s.cost),
      attendees: s.attendees.length,
      per_head: round2(s.cost / s.attendees.length),
    });
  });

  const payments = new Map<string, number>();
  for (const p of input.payments ?? []) {
    if (!p || typeof p.name !== "string" || !p.name.trim()) throw new Error("payments entries need a name.");
    if (!Number.isFinite(p.paid) || (p.paid as number) < 0) throw new Error(`payment for ${p.name} must be a non-negative number.`);
    payments.set(p.name.trim(), Math.round((p.paid as number) * 100));
  }

  const allNames = new Set<string>([...(input.players ?? []).map((n) => n.trim()), ...owedCents.keys(), ...payments.keys()]);
  const balances: Balance[] = [...allNames].map((name) => {
    const owed = owedCents.get(name) ?? 0;
    const paid = payments.get(name) ?? 0;
    return { name, paid: round2(paid / 100), owed: round2(owed / 100), balance: round2((paid - owed) / 100) };
  });

  return {
    currency: input.currency ?? "USD",
    total_cost: round2(totalCents / 100),
    session_count: input.sessions.length,
    sessions: sessionDetails,
    players: balances.map((b) => ({ ...b, sessions_played: played.get(b.name) ?? 0 })),
    transfers: minimizeTransfers(balances),
    note: "Each session cost is split only among that session's attendees; transfers settle everyone with the fewest payments.",
  };
}

export interface RotationInput {
  players: string[];
  capacity: number;
  courts?: number;
  rounds: number;
}

export function rotationPlan(input: RotationInput): object {
  if (!Array.isArray(input.players) || input.players.length < 2) throw new Error("players must be a list of at least 2 names.");
  const players = input.players.map((n) => (typeof n === "string" ? n.trim() : "")).filter(Boolean);
  if (players.length !== input.players.length || new Set(players).size !== players.length) {
    throw new Error("player names must be non-empty and unique.");
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1) throw new Error("capacity must be a positive integer (players per court, e.g. 4 for doubles).");
  const courts = input.courts ?? 1;
  if (!Number.isInteger(courts) || courts < 1) throw new Error("courts must be a positive integer.");
  if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > 50) throw new Error("rounds must be an integer between 1 and 50.");
  const slots = input.capacity * courts;
  if (slots > players.length) throw new Error(`need at least ${slots} players for ${courts} court(s) of ${input.capacity}; got ${players.length}.`);
  if (slots === players.length && courts === 1 && input.capacity === 2) throw new Error("with exactly one singles match there is no rotation; add players or courts.");

  const games = new Map<string, number>(players.map((n) => [n, 0]));
  const lastRound = new Map<string, number>(players.map((n) => [n, -1]));
  const schedule: Array<Record<string, unknown>> = [];

  for (let r = 0; r < input.rounds; r++) {
    const ordered = [...players].sort((a, b) => {
      const ga = games.get(a) ?? 0;
      const gb = games.get(b) ?? 0;
      if (ga !== gb) return ga - gb;
      const la = lastRound.get(a) ?? -1;
      const lb = lastRound.get(b) ?? -1;
      if (la !== lb) return la - lb;
      return a.localeCompare(b);
    });
    const playing = ordered.slice(0, slots);
    const sitting = ordered.slice(slots);
    const courtAssignments: string[][] = [];
    for (let c = 0; c < courts; c++) courtAssignments.push(playing.slice(c * input.capacity, (c + 1) * input.capacity));
    playing.forEach((n) => {
      games.set(n, (games.get(n) ?? 0) + 1);
      lastRound.set(n, r);
    });
    schedule.push({ round: r + 1, courts: courtAssignments, sitting });
  }

  const counts = players.map((n) => ({ name: n, games: games.get(n) ?? 0 }));
  const min = Math.min(...counts.map((c) => c.games));
  const max = Math.max(...counts.map((c) => c.games));

  return {
    format: `${input.capacity}v${input.capacity} on ${courts} court(s)`,
    rounds: input.rounds,
    fairness: { min_games: min, max_games: max, spread: max - min },
    schedule,
    note: max - min <= 1 ? "Balanced: nobody plays more than one game more than anyone else." : "Rough balance: rerun with more rounds for a perfectly even spread.",
  };
}
