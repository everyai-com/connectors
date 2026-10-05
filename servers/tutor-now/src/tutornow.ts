/** TutorNow engine - tutor matching, plan quotes and intro-session requests.
 * Pure data + deterministic logic; shared by the MCP server and the Worker.
 * Slots are deterministic per tutor+date (stable across isolates). */

export const SUBJECTS = ["math", "physics", "chemistry", "biology", "english", "history", "spanish", "computer-science"];
const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const DAY_HOURS = [9, 11, 14, 16, 18]; // UTC start hours tutors may offer

export type Tutor = {
  id: string; name: string; subjects: string[]; grades: string[];
  rate_usd_hr: number; rating: number; sessions_taught: number; bio: string;
};

const TUTORS: Tutor[] = [
  { id: "tut_asha", name: "Asha Rao", subjects: ["math", "physics"], grades: ["6", "7", "8", "9", "10"], rate_usd_hr: 45, rating: 4.9, sessions_taught: 620, bio: "IIT graduate; middle-school math specialist, Singapore Math methods." },
  { id: "tut_dev", name: "Dev Patel", subjects: ["math", "computer-science"], grades: ["8", "9", "10", "11", "12"], rate_usd_hr: 55, rating: 4.8, sessions_taught: 410, bio: "Ex-FAANG engineer; algebra-to-calculus plus AP Computer Science." },
  { id: "tut_mira", name: "Mira Nair", subjects: ["chemistry", "biology"], grades: ["9", "10", "11", "12"], rate_usd_hr: 50, rating: 4.9, sessions_taught: 530, bio: "PhD chemist; AP Chem/Bio with lab-style problem sets." },
  { id: "tut_kiran", name: "Kiran Shah", subjects: ["physics", "math"], grades: ["11", "12"], rate_usd_hr: 60, rating: 4.7, sessions_taught: 280, bio: "Physics Olympiad coach; mechanics and E&M deep dives." },
  { id: "tut_priya", name: "Priya Iyer", subjects: ["english", "history"], grades: ["6", "7", "8", "9", "10"], rate_usd_hr: 40, rating: 4.9, sessions_taught: 700, bio: "Former school teacher; essay writing and reading comprehension." },
  { id: "tut_arjun", name: "Arjun Mehta", subjects: ["math"], grades: ["K", "1", "2", "3", "4", "5"], rate_usd_hr: 30, rating: 4.8, sessions_taught: 350, bio: "Early-math specialist; number sense through games and visuals." },
  { id: "tut_sana", name: "Sana Khan", subjects: ["biology", "chemistry"], grades: ["6", "7", "8"], rate_usd_hr: 35, rating: 4.7, sessions_taught: 190, bio: "Medical student; life-science foundations with diagrams." },
  { id: "tut_rahul", name: "Rahul Verma", subjects: ["computer-science", "math"], grades: ["9", "10", "11", "12"], rate_usd_hr: 65, rating: 5.0, sessions_taught: 240, bio: "Competitive programmer; Python, DSA and AP CSA." },
  { id: "tut_divya", name: "Divya Reddy", subjects: ["spanish", "english"], grades: ["6", "7", "8", "9", "10", "11", "12"], rate_usd_hr: 38, rating: 4.8, sessions_taught: 460, bio: "DELE C1; conversational Spanish and ESL support." },
  { id: "tut_nikhil", name: "Nikhil Bose", subjects: ["history", "english"], grades: ["9", "10", "11", "12"], rate_usd_hr: 42, rating: 4.6, sessions_taught: 150, bio: "History graduate; AP US/European history and DBQ writing." },
  { id: "tut_anjali", name: "Anjali Gupta", subjects: ["math", "physics", "chemistry"], grades: ["10", "11", "12"], rate_usd_hr: 70, rating: 4.9, sessions_taught: 380, bio: "IIT Delhi; JEE/NEET-style PCM problem drilling." },
  { id: "tut_vikram", name: "Vikram Singh", subjects: ["math", "english"], grades: ["3", "4", "5", "6", "7"], rate_usd_hr: 32, rating: 4.7, sessions_taught: 210, bio: "Patient generalist for upper-primary math and writing." },
];

export type IntroRequest = {
  id: string; tutor_id: string; starts_at: string; student_name: string;
  subject: string; grade: string; contact: string;
  status: "requested" | "cancelled"; idempotency_key: string;
};
const requests = new Map<string, IntroRequest>();
const byIdempotency = new Map<string, IntroRequest>();

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const findTutor = (id: string) => {
  const t = TUTORS.find((x) => x.id === id);
  if (!t) throw new Error(`ERROR unknown tutor_id '${id}'. Call search_tutors for valid ids.`);
  return t;
};
const checkSubject = (subject: string) => {
  if (!SUBJECTS.includes(subject)) throw new Error(`ERROR unknown subject '${subject}'. Valid: ${SUBJECTS.join(", ")}.`);
};
const checkGrade = (grade: string) => {
  if (!GRADES.includes(grade)) throw new Error(`ERROR grade must be K or 1-12, got '${grade}'.`);
};
const checkDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`ERROR date must be YYYY-MM-DD, got '${date}'.`);
};

export function searchTutors(o: { subject: string; grade?: string; max_rate?: number; limit?: number }) {
  checkSubject(o.subject);
  if (o.grade !== undefined) checkGrade(o.grade);
  let out = TUTORS.filter((t) => t.subjects.includes(o.subject));
  if (o.grade !== undefined) out = out.filter((t) => t.grades.includes(o.grade as string));
  if (o.max_rate !== undefined) out = out.filter((t) => t.rate_usd_hr <= (o.max_rate as number));
  out = out.sort((a, b) => b.rating - a.rating || b.sessions_taught - a.sessions_taught);
  const limit = Math.min(Math.max(o.limit ?? 5, 1), 12);
  return out.slice(0, limit).map((t) => ({
    id: t.id, name: t.name, subjects: t.subjects, grades: t.grades,
    rate_usd_hr: t.rate_usd_hr, rating: t.rating, sessions_taught: t.sessions_taught, bio: t.bio,
  }));
}

export function tutorProfile(o: { tutor_id: string }) {
  const t = findTutor(o.tutor_id);
  return { ...t, intro_note: "Tutors confirm intro requests within 24 hours. No charge until a plan starts." };
}

export function tutorSlots(o: { tutor_id: string; date: string }) {
  const t = findTutor(o.tutor_id);
  checkDate(o.date);
  const h = hash(`${t.id}:${o.date}`);
  const slots = DAY_HOURS.filter((_, i) => (h >> i) % 2 === 0 || i === 0)
    .map((hh) => `${o.date}T${String(hh).padStart(2, "0")}:00:00Z`);
  const taken = new Set([...requests.values()]
    .filter((r) => r.tutor_id === t.id && r.status === "requested").map((r) => r.starts_at));
  return { tutor_id: t.id, date: o.date, slots: slots.filter((s) => !taken.has(s)) };
}

export function quotePlan(o: { tutor_id: string; sessions_per_week: number; weeks: number }) {
  const t = findTutor(o.tutor_id);
  if (![1, 2, 3, 4, 5].includes(o.sessions_per_week)) throw new Error("ERROR sessions_per_week must be 1-5.");
  if (!Number.isInteger(o.weeks) || o.weeks < 1 || o.weeks > 24) throw new Error("ERROR weeks must be 1-24.");
  const sessions = o.sessions_per_week * o.weeks;
  const discount = o.weeks >= 12 ? 0.15 : o.weeks >= 4 ? 0.1 : 0;
  const total = Math.round(sessions * t.rate_usd_hr * (1 - discount));
  return {
    tutor_id: t.id, tutor_name: t.name, sessions_per_week: o.sessions_per_week,
    weeks: o.weeks, sessions, rate_usd_hr: t.rate_usd_hr,
    discount_pct: discount * 100, total_usd: total,
    note: discount ? `${discount * 100}% long-plan discount applied.` : "Plans of 4+ weeks earn 10-15% off.",
  };
}

export function requestIntro(o: {
  tutor_id: string; starts_at: string; student_name: string;
  subject: string; grade: string; contact: string; idempotency_key: string;
}) {
  const dupe = byIdempotency.get(o.idempotency_key);
  if (dupe) return { ...dupe, deduped: true };
  const t = findTutor(o.tutor_id);
  checkSubject(o.subject);
  if (!t.subjects.includes(o.subject)) throw new Error(`ERROR ${t.name} does not teach '${o.subject}'. Teaches: ${t.subjects.join(", ")}.`);
  checkGrade(o.grade);
  if (!t.grades.includes(o.grade)) throw new Error(`ERROR ${t.name} does not teach grade '${o.grade}'. Teaches: ${t.grades.join(", ")}.`);
  if (!o.student_name?.trim()) throw new Error("ERROR student_name must be a non-empty string.");
  if (!o.contact?.trim()) throw new Error("ERROR contact must be a non-empty string (email or phone).");
  const open = tutorSlots({ tutor_id: t.id, date: o.starts_at.slice(0, 10) }).slots;
  if (!open.includes(o.starts_at)) throw new Error(`ERROR slot '${o.starts_at}' is not open. Open slots: ${open.join(", ") || "none"}.`);
  const r: IntroRequest = {
    id: `tr_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    tutor_id: t.id, starts_at: o.starts_at, student_name: o.student_name.trim(),
    subject: o.subject, grade: o.grade, contact: o.contact.trim(),
    status: "requested", idempotency_key: o.idempotency_key,
  };
  requests.set(r.id, r);
  byIdempotency.set(o.idempotency_key, r);
  return { ...r, note: "Request held. The tutor confirms within 24 hours; nothing is charged for the intro." };
}

export function getRequest(o: { request_id: string }) {
  const r = requests.get(o.request_id);
  if (!r) throw new Error(`ERROR no request '${o.request_id}'.`);
  return r;
}

export function cancelRequest(o: { request_id: string }) {
  const r = requests.get(o.request_id);
  if (!r) throw new Error(`ERROR no request '${o.request_id}'.`);
  r.status = "cancelled";
  return r;
}
