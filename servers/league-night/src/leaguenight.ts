/**
 * LeagueNight engine - round-robin fixtures, standings tables, match-day plans
 * and season planning for sports league organizers.
 * Pure computation: no storage, no network, no money.
 */

export interface Fixture {
  home: string;
  away: string;
}

export type Slot = Fixture | { bye: string };

export interface RoundRobinInput {
  teams: string[];
  rounds?: number;
  second_leg?: boolean;
}

export interface ResultRow {
  home: string;
  away: string;
  home_score: number;
  away_score: number;
}

export interface StandingsInput {
  results: ResultRow[];
  teams?: string[];
  points_win?: number;
  points_draw?: number;
}

export interface MatchDayInput {
  games: Fixture[];
  courts: number;
  slot_minutes: number;
  start_time: string;
}

export interface SeasonPlanInput {
  teams: string[];
  courts: number;
  slot_minutes: number;
  start_date: string;
  days_between_rounds?: number;
  second_leg?: boolean;
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Validates a roster: 2-100 unique, non-empty team names (trimmed). */
function cleanTeams(input: string[]): string[] {
  if (!Array.isArray(input) || input.length < 2) throw new Error("teams must be a list of at least 2 team names.");
  const teams = input.map((t) => (typeof t === "string" ? t.trim() : ""));
  if (teams.some((t) => !t)) throw new Error("every team name must be a non-empty string.");
  if (new Set(teams).size !== teams.length) throw new Error("team names must be unique (after trimming).");
  if (teams.length > 100) throw new Error(`at most 100 teams are supported; got ${teams.length}.`);
  return teams;
}

/**
 * Circle method: keep the first team fixed and rotate the rest; with an odd
 * count one placeholder is added so exactly one team gets a { bye } per round.
 * Home/away alternates by round so no team stays fixed at home.
 */
function circleRounds(teams: string[]): Slot[][] {
  const pool: Array<string | null> = [...teams];
  if (pool.length % 2 === 1) pool.push(null); // bye placeholder
  const n = pool.length;
  const rounds: Slot[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const fixtures: Slot[] = [];
    const flip = r % 2 === 1;
    for (let i = 0; i < n / 2; i++) {
      const a = pool[i];
      const b = pool[n - 1 - i];
      const home = flip ? b : a;
      const away = flip ? a : b;
      if (home === null) fixtures.push({ bye: away as string });
      else if (away === null) fixtures.push({ bye: home });
      else fixtures.push({ home, away });
    }
    rounds.push(fixtures);
    pool.splice(1, 0, pool.pop() as string | null); // first team fixed, others rotate
  }
  return rounds;
}

export function roundRobinSchedule(input: RoundRobinInput): object {
  const teams = cleanTeams(input.teams);
  const firstLeg = circleRounds(teams);
  const full: Slot[][] = input.second_leg
    ? [...firstLeg, ...firstLeg.map((round) => round.map((f) => ("bye" in f ? f : { home: f.away, away: f.home })))]
    : firstLeg;
  const maxRounds = full.length;
  if (input.rounds !== undefined) {
    if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > maxRounds) {
      throw new Error(`rounds must be an integer between 1 and ${maxRounds} (${teams.length} teams, ${input.second_leg ? "second leg included" : "single round-robin"}).`);
    }
  }
  const shown = input.rounds === undefined ? full : full.slice(0, input.rounds);
  const rounds = shown.map((fixtures, i) => ({ round: i + 1, fixtures }));

  const counts = new Map<string, number>(teams.map((t) => [t, 0]));
  let total_games = 0;
  for (const round of shown) {
    for (const f of round) {
      if ("bye" in f) continue;
      total_games += 1;
      counts.set(f.home, (counts.get(f.home) ?? 0) + 1);
      counts.set(f.away, (counts.get(f.away) ?? 0) + 1);
    }
  }
  const perTeam = [...counts.values()];
  const minGames = Math.min(...perTeam);
  const maxGames = Math.max(...perTeam);
  const games_per_team = Math.round(((total_games * 2) / teams.length) * 100) / 100;

  const noteParts = [
    `${teams.length} teams, ${rounds.length} round(s), ${total_games} fixture(s)`,
    maxGames === minGames ? `each team plays ${maxGames} game(s)` : `teams play between ${minGames} and ${maxGames} game(s)`,
  ];
  if (teams.length % 2 === 1) noteParts.push("one team has a bye each round");
  if (input.second_leg) noteParts.push("the second leg mirrors the first with home and away swapped");
  if (input.rounds !== undefined && input.rounds < full.length) noteParts.push(`truncated to the first ${input.rounds} of ${full.length} available rounds`);

  return {
    teams,
    legs: shown.length > firstLeg.length ? 2 : 1,
    rounds,
    games_per_team,
    total_games,
    note: `${noteParts.join("; ")}.`,
  };
}

export function standingsTable(input: StandingsInput): object {
  if (!Array.isArray(input.results)) throw new Error("results must be a list of {home, away, home_score, away_score}.");
  let roster: string[] | null = null;
  if (input.teams !== undefined) {
    if (!Array.isArray(input.teams) || input.teams.length < 2) throw new Error("teams, when provided, must be a list of at least 2 names.");
    const cleaned = input.teams.map((t) => (typeof t === "string" ? t.trim() : ""));
    if (cleaned.some((t) => !t)) throw new Error("every team in teams must be a non-empty name.");
    if (new Set(cleaned).size !== cleaned.length) throw new Error("team names must be unique (after trimming).");
    roster = cleaned;
  }
  if (input.results.length === 0 && !roster) throw new Error("provide at least one result, or a teams list for a zeroed table.");
  const winPts = input.points_win ?? 3;
  const drawPts = input.points_draw ?? 1;
  if (!Number.isFinite(winPts) || winPts < 0) throw new Error("points_win must be a non-negative number (default 3).");
  if (!Number.isFinite(drawPts) || drawPts < 0) throw new Error("points_draw must be a non-negative number (default 1).");

  interface Row { team: string; played: number; wins: number; draws: number; losses: number; gf: number; ga: number }
  const stats = new Map<string, Row>();
  const ensure = (team: string): Row => {
    let row = stats.get(team);
    if (!row) {
      row = { team, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 };
      stats.set(team, row);
    }
    return row;
  };
  if (roster) for (const team of roster) ensure(team);
  const known = new Set(roster ?? []);

  const warnings: string[] = [];
  const seenWarnings = new Set<string>();
  input.results.forEach((r, i) => {
    if (!r || typeof r.home !== "string" || !r.home.trim() || typeof r.away !== "string" || !r.away.trim()) {
      throw new Error(`result ${i + 1}: both home and away team names are required.`);
    }
    const home = r.home.trim();
    const away = r.away.trim();
    if (home === away) throw new Error(`result ${i + 1}: '${home}' cannot play itself.`);
    if (!Number.isInteger(r.home_score) || r.home_score < 0) throw new Error(`result ${i + 1}: home_score must be a non-negative integer.`);
    if (!Number.isInteger(r.away_score) || r.away_score < 0) throw new Error(`result ${i + 1}: away_score must be a non-negative integer.`);
    if (roster && (!known.has(home) || !known.has(away))) {
      const unknown = [home, away].filter((t) => !known.has(t));
      const warning = `result ${i + 1} (${home} vs ${away}) references team(s) not in the teams list: ${unknown.join(", ")}; skipped.`;
      if (!seenWarnings.has(warning)) {
        seenWarnings.add(warning);
        warnings.push(warning);
      }
      return;
    }
    const h = ensure(home);
    const a = ensure(away);
    h.played += 1;
    a.played += 1;
    h.gf += r.home_score;
    h.ga += r.away_score;
    a.gf += r.away_score;
    a.ga += r.home_score;
    if (r.home_score > r.away_score) {
      h.wins += 1;
      a.losses += 1;
    } else if (r.home_score < r.away_score) {
      a.wins += 1;
      h.losses += 1;
    } else {
      h.draws += 1;
      a.draws += 1;
    }
  });

  const table = [...stats.values()]
    .map((r) => ({
      team: r.team,
      played: r.played,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      gf: r.gf,
      ga: r.ga,
      gd: r.gf - r.ga,
      points: Math.round((r.wins * winPts + r.draws * drawPts) * 100) / 100,
    }))
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || byName(a.team, b.team));

  return { table, warnings, points_system: { win: winPts, draw: drawPts } };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseHhmm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function formatHhmm(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

export function matchDayPlan(input: MatchDayInput): object {
  if (!Array.isArray(input.games) || input.games.length === 0) throw new Error("games must be a non-empty list of {home, away}.");
  if (!Number.isInteger(input.courts) || input.courts < 1 || input.courts > 12) throw new Error("courts must be an integer between 1 and 12.");
  if (!Number.isInteger(input.slot_minutes) || input.slot_minutes < 10 || input.slot_minutes > 180) throw new Error("slot_minutes must be an integer between 10 and 180.");
  if (typeof input.start_time !== "string" || !HHMM.test(input.start_time)) throw new Error('start_time must be a 24h "HH:MM" time (e.g. "09:30").');
  const games = input.games.map((g, i) => {
    if (!g || typeof g.home !== "string" || !g.home.trim() || typeof g.away !== "string" || !g.away.trim()) {
      throw new Error(`game ${i + 1}: both home and away team names are required.`);
    }
    return { home: g.home.trim(), away: g.away.trim() };
  });

  const slots = Math.ceil(games.length / input.courts);
  const startMin = parseHhmm(input.start_time);
  const total_minutes = slots * input.slot_minutes;
  const endMin = startMin + total_minutes;
  const timeline = games.map((g, i) => ({
    time_hhmm: formatHhmm(startMin + Math.floor(i / input.courts) * input.slot_minutes),
    court: (i % input.courts) + 1,
    home: g.home,
    away: g.away,
  }));
  const lastSlotCourts = games.length - (slots - 1) * input.courts;

  return {
    start_time: input.start_time,
    end_time: formatHhmm(endMin),
    courts: input.courts,
    slot_minutes: input.slot_minutes,
    timeline,
    total_minutes,
    note:
      `${games.length} game(s) in ${slots} slot(s) of ${input.slot_minutes} min on ${input.courts} court(s) running in parallel; ` +
      `the final slot uses ${lastSlotCourts} court(s).` +
      (endMin >= 1440 ? " The last slot finishes after midnight." : ""),
  };
}

function parseDateUtc(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('start_date must be a "YYYY-MM-DD" date (e.g. "2026-10-04").');
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`start_date '${value}' is not a real calendar date.`);
  }
  return ms;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function seasonPlan(input: SeasonPlanInput): object {
  const teams = cleanTeams(input.teams);
  if (!Number.isInteger(input.courts) || input.courts < 1 || input.courts > 12) throw new Error("courts must be an integer between 1 and 12.");
  if (!Number.isInteger(input.slot_minutes) || input.slot_minutes < 10 || input.slot_minutes > 180) throw new Error("slot_minutes must be an integer between 10 and 180.");
  const startMs = parseDateUtc(input.start_date);
  const gap = input.days_between_rounds ?? 7;
  if (!Number.isInteger(gap) || gap < 1 || gap > 60) throw new Error("days_between_rounds must be an integer between 1 and 60 (default 7).");

  const n = teams.length;
  const legs = input.second_leg ? 2 : 1;
  const games_total = ((n * (n - 1)) / 2) * legs;
  const games_per_round = Math.min(Math.floor(n / 2), input.courts);
  const rounds_needed = Math.ceil(games_total / games_per_round);
  const per_team_games = (n - 1) * legs;
  const dates: string[] = [];
  for (let i = 0; i < rounds_needed; i++) {
    dates.push(isoDate(startMs + i * gap * 86400000));
  }
  const finish_date = dates[dates.length - 1];

  return {
    rounds_needed,
    games_total,
    games_per_round,
    per_team_games,
    dates,
    finish_date,
    note:
      `${n} teams, ${legs === 2 ? "double-leg" : "single-leg"} round-robin: ${games_total} fixture(s) over ${rounds_needed} match day(s), ` +
      `up to ${games_per_round} game(s) per day on ${input.courts} court(s), one ${input.slot_minutes}-min slot per day. ` +
      `Match days run every ${gap} day(s) from ${input.start_date} to ${finish_date}; each team plays ${per_team_games} game(s).` +
      (n % 2 === 1 ? " With an odd team count one team has a bye in each fixture round." : ""),
  };
}
