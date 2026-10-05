/**
 * FlightFix engine - EU261 / UK261 flight compensation rules.
 * Pure computation: airport distances, eligibility, amounts, rights, letters.
 * Informational self-help based on Regulation (EC) 261/2004 and UK261; not legal advice.
 */

export interface Airport {
  iata: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

// Major airports: iata -> [city, country code, lat, lon]. Approximate great-circle use.
const AIRPORT_DATA: Record<string, [string, string, number, number]> = {
  // United Kingdom / Ireland
  LHR: ["London Heathrow", "GB", 51.47, -0.454], LGW: ["London Gatwick", "GB", 51.153, -0.19],
  STN: ["London Stansted", "GB", 51.885, 0.235], MAN: ["Manchester", "GB", 53.365, -2.273],
  EDI: ["Edinburgh", "GB", 55.95, -3.363], BHX: ["Birmingham", "GB", 52.454, -1.748],
  GLA: ["Glasgow", "GB", 55.872, -4.433], BRS: ["Bristol", "GB", 51.383, -2.719],
  LTN: ["London Luton", "GB", 51.875, -0.368], DUB: ["Dublin", "IE", 53.421, -6.27],
  // France
  CDG: ["Paris Charles de Gaulle", "FR", 49.01, 2.55], ORY: ["Paris Orly", "FR", 48.723, 2.379],
  NCE: ["Nice", "FR", 43.658, 7.216], LYS: ["Lyon", "FR", 45.726, 5.09],
  MRS: ["Marseille", "FR", 43.439, 5.221], TLS: ["Toulouse", "FR", 43.63, 1.367],
  BOD: ["Bordeaux", "FR", 44.828, -0.716],
  // Germany
  FRA: ["Frankfurt", "DE", 50.033, 8.57], MUC: ["Munich", "DE", 48.353, 11.786],
  BER: ["Berlin Brandenburg", "DE", 52.366, 13.503], DUS: ["Dusseldorf", "DE", 51.289, 6.767],
  HAM: ["Hamburg", "DE", 53.63, 9.988], STR: ["Stuttgart", "DE", 48.69, 9.204],
  CGN: ["Cologne", "DE", 50.866, 7.143],
  // Benelux / Alps
  AMS: ["Amsterdam", "NL", 52.311, 4.764], EIN: ["Eindhoven", "NL", 51.459, 5.375],
  BRU: ["Brussels", "BE", 50.901, 4.484], LUX: ["Luxembourg", "LU", 49.623, 6.205],
  ZRH: ["Zurich", "CH", 47.464, 8.549], GVA: ["Geneva", "CH", 46.238, 6.109],
  BSL: ["Basel", "CH", 47.6, 7.53], VIE: ["Vienna", "AT", 48.11, 16.57],
  SZG: ["Salzburg", "AT", 47.793, 13.004],
  // Italy
  FCO: ["Rome Fiumicino", "IT", 41.8, 12.239], MXP: ["Milan Malpensa", "IT", 45.63, 8.723],
  LIN: ["Milan Linate", "IT", 45.445, 9.277], VCE: ["Venice", "IT", 45.505, 12.352],
  NAP: ["Naples", "IT", 40.886, 14.29], BLQ: ["Bologna", "IT", 44.535, 11.288],
  FLR: ["Florence", "IT", 43.81, 11.205], PSA: ["Pisa", "IT", 43.684, 10.393],
  BRI: ["Bari", "IT", 41.139, 16.761], CTA: ["Catania", "IT", 37.467, 15.066],
  PMO: ["Palermo", "IT", 38.176, 13.091],
  // Iberia
  MAD: ["Madrid", "ES", 40.472, -3.561], BCN: ["Barcelona", "ES", 41.297, 2.083],
  PMI: ["Palma de Mallorca", "ES", 39.55, 2.738], AGP: ["Malaga", "ES", 36.675, -4.499],
  VLC: ["Valencia", "ES", 39.489, -0.482], SVQ: ["Seville", "ES", 37.418, -5.893],
  BIO: ["Bilbao", "ES", 43.301, -2.911], TFS: ["Tenerife South", "ES", 28.044, -16.572],
  LPA: ["Gran Canaria", "ES", 27.932, -15.386], IBZ: ["Ibiza", "ES", 38.873, 1.373],
  LIS: ["Lisbon", "PT", 38.774, -9.134], OPO: ["Porto", "PT", 41.248, -8.681],
  FAO: ["Faro", "PT", 37.014, -7.966],
  // Greece / Mediterranean
  ATH: ["Athens", "GR", 37.936, 23.945], SKG: ["Thessaloniki", "GR", 40.519, 22.971],
  HER: ["Heraklion", "GR", 35.34, 25.18], RHO: ["Rhodes", "GR", 36.405, 28.086],
  CFU: ["Corfu", "GR", 39.601, 19.912], JTR: ["Santorini", "GR", 36.4, 25.479],
  JMK: ["Mykonos", "GR", 37.435, 25.348], MLA: ["Malta", "MT", 35.857, 14.477],
  LCA: ["Larnaca", "CY", 34.875, 33.625], PFO: ["Paphos", "CY", 34.718, 32.486],
  // Nordics / Baltics
  CPH: ["Copenhagen", "DK", 55.618, 12.656], BLL: ["Billund", "DK", 55.74, 9.152],
  ARN: ["Stockholm Arlanda", "SE", 59.651, 17.919], GOT: ["Gothenburg", "SE", 57.663, 12.28],
  OSL: ["Oslo", "NO", 60.194, 11.1], BGO: ["Bergen", "NO", 60.293, 5.218],
  SVG: ["Stavanger", "NO", 58.877, 5.638], TRD: ["Trondheim", "NO", 63.457, 10.924],
  HEL: ["Helsinki", "FI", 60.317, 24.963], KEF: ["Reykjavik Keflavik", "IS", 63.985, -22.605],
  // Central / Eastern Europe
  WAW: ["Warsaw", "PL", 52.166, 20.967], KRK: ["Krakow", "PL", 50.078, 19.785],
  GDN: ["Gdansk", "PL", 54.378, 18.466], WRO: ["Wroclaw", "PL", 51.103, 16.886],
  POZ: ["Poznan", "PL", 52.421, 16.826], PRG: ["Prague", "CZ", 50.101, 14.26],
  BTS: ["Bratislava", "SK", 48.17, 17.213], BUD: ["Budapest", "HU", 47.437, 19.256],
  OTP: ["Bucharest", "RO", 44.572, 26.102], CLJ: ["Cluj-Napoca", "RO", 46.785, 23.686],
  SOF: ["Sofia", "BG", 42.696, 23.412], VAR: ["Varna", "BG", 43.232, 27.825],
  ZAG: ["Zagreb", "HR", 45.743, 16.069], SPU: ["Split", "HR", 43.539, 16.298],
  DBV: ["Dubrovnik", "HR", 42.561, 18.268], LJU: ["Ljubljana", "SI", 46.224, 14.458],
  BEG: ["Belgrade", "RS", 44.818, 20.309], SJJ: ["Sarajevo", "BA", 43.825, 18.331],
  // Turkey (non-EU)
  IST: ["Istanbul", "TR", 41.275, 28.752], AYT: ["Antalya", "TR", 36.899, 30.8],
  ESB: ["Ankara", "TR", 40.128, 32.995], ADB: ["Izmir", "TR", 38.292, 27.157],
  // North America
  JFK: ["New York JFK", "US", 40.64, -73.779], EWR: ["Newark", "US", 40.689, -74.175],
  LGA: ["New York LaGuardia", "US", 40.777, -73.873], BOS: ["Boston", "US", 42.365, -71.009],
  IAD: ["Washington Dulles", "US", 38.953, -77.456], DCA: ["Washington National", "US", 38.852, -77.037],
  ATL: ["Atlanta", "US", 33.64, -84.427], MIA: ["Miami", "US", 25.795, -80.279],
  MCO: ["Orlando", "US", 28.431, -81.308], FLL: ["Fort Lauderdale", "US", 26.074, -80.15],
  ORD: ["Chicago O'Hare", "US", 41.978, -87.905], MDW: ["Chicago Midway", "US", 41.786, -87.752],
  DFW: ["Dallas Fort Worth", "US", 32.897, -97.038], IAH: ["Houston", "US", 29.984, -95.341],
  DEN: ["Denver", "US", 39.861, -104.673], LAX: ["Los Angeles", "US", 33.943, -118.408],
  SFO: ["San Francisco", "US", 37.619, -122.375], SJC: ["San Jose", "US", 37.363, -121.929],
  SEA: ["Seattle", "US", 47.45, -122.309], PDX: ["Portland", "US", 45.589, -122.596],
  LAS: ["Las Vegas", "US", 36.084, -115.154], PHX: ["Phoenix", "US", 33.434, -112.011],
  MSP: ["Minneapolis", "US", 44.884, -93.222], DTW: ["Detroit", "US", 42.213, -83.354],
  CLT: ["Charlotte", "US", 35.214, -80.947], PHL: ["Philadelphia", "US", 39.874, -75.242],
  BWI: ["Baltimore", "US", 39.175, -76.668], SAN: ["San Diego", "US", 32.734, -117.19],
  TPA: ["Tampa", "US", 27.976, -82.533], AUS: ["Austin", "US", 30.194, -97.67],
  BNA: ["Nashville", "US", 36.124, -86.678], STL: ["St. Louis", "US", 38.75, -90.37],
  SLC: ["Salt Lake City", "US", 40.789, -111.978], HNL: ["Honolulu", "US", 21.319, -157.922],
  OGG: ["Kahului Maui", "US", 20.899, -156.43], ANC: ["Anchorage", "US", 61.174, -149.996],
  RDU: ["Raleigh-Durham", "US", 35.878, -78.787], CLE: ["Cleveland", "US", 41.411, -81.85],
  CMH: ["Columbus", "US", 39.998, -82.892], IND: ["Indianapolis", "US", 39.717, -86.294],
  MCI: ["Kansas City", "US", 39.297, -94.714], MSY: ["New Orleans", "US", 29.993, -90.258],
  SAT: ["San Antonio", "US", 29.534, -98.469], SMF: ["Sacramento", "US", 38.695, -121.591],
  OAK: ["Oakland", "US", 37.721, -122.221], BUR: ["Burbank", "US", 34.2, -118.359],
  SNA: ["Santa Ana", "US", 33.675, -117.868],
  YYZ: ["Toronto", "CA", 43.677, -79.631], YVR: ["Vancouver", "CA", 49.194, -123.179],
  YUL: ["Montreal", "CA", 45.471, -73.741], YYC: ["Calgary", "CA", 51.113, -114.02],
  YOW: ["Ottawa", "CA", 45.322, -75.669], MEX: ["Mexico City", "MX", 19.436, -99.072],
  CUN: ["Cancun", "MX", 21.037, -86.877],
  // South America
  GRU: ["Sao Paulo", "BR", -23.435, -46.473], GIG: ["Rio de Janeiro", "BR", -22.81, -43.25],
  EZE: ["Buenos Aires", "AR", -34.822, -58.536], BOG: ["Bogota", "CO", 4.701, -74.147],
  LIM: ["Lima", "PE", -12.022, -77.114], SCL: ["Santiago", "CL", -33.393, -70.786],
  // Asia / Pacific / Africa / Middle East
  NRT: ["Tokyo Narita", "JP", 35.765, 140.386], HND: ["Tokyo Haneda", "JP", 35.553, 139.781],
  KIX: ["Osaka", "JP", 34.427, 135.244], CTS: ["Sapporo", "JP", 42.775, 141.692],
  ICN: ["Seoul Incheon", "KR", 37.469, 126.451], PEK: ["Beijing", "CN", 40.08, 116.585],
  PVG: ["Shanghai Pudong", "CN", 31.143, 121.805], CAN: ["Guangzhou", "CN", 23.392, 113.299],
  HKG: ["Hong Kong", "HK", 22.309, 113.915], SIN: ["Singapore", "SG", 1.364, 103.991],
  BKK: ["Bangkok", "TH", 13.681, 100.747], DEL: ["Delhi", "IN", 28.556, 77.1],
  BOM: ["Mumbai", "IN", 19.089, 72.868], BLR: ["Bengaluru", "IN", 13.199, 77.71],
  MAA: ["Chennai", "IN", 12.99, 80.169], HYD: ["Hyderabad", "IN", 17.24, 78.429],
  DXB: ["Dubai", "AE", 25.253, 55.365], AUH: ["Abu Dhabi", "AE", 24.433, 54.651],
  SHJ: ["Sharjah", "AE", 25.328, 55.517], DOH: ["Doha", "QA", 25.273, 51.608],
  JED: ["Jeddah", "SA", 21.679, 39.157], RUH: ["Riyadh", "SA", 24.958, 46.699],
  TLV: ["Tel Aviv", "IL", 32.011, 34.887], JNB: ["Johannesburg", "ZA", -26.139, 28.246],
  CPT: ["Cape Town", "ZA", -33.971, 18.602], CAI: ["Cairo", "EG", 30.112, 31.406],
  NBO: ["Nairobi", "KE", -1.319, 36.928], LOS: ["Lagos", "NG", 6.577, 3.321],
  CMN: ["Casablanca", "MA", 33.367, -7.59], SYD: ["Sydney", "AU", -33.946, 151.177],
  MEL: ["Melbourne", "AU", -37.673, 144.843], BNE: ["Brisbane", "AU", -27.384, 153.117],
  PER: ["Perth", "AU", -31.94, 115.967], AKL: ["Auckland", "NZ", -37.008, 174.792],
  MNL: ["Manila", "PH", 14.509, 121.019], CGK: ["Jakarta", "ID", -6.126, 106.656],
  DPS: ["Bali Denpasar", "ID", -8.748, 115.167], KUL: ["Kuala Lumpur", "MY", 2.746, 101.71],
  SGN: ["Ho Chi Minh City", "VN", 10.819, 106.652], HAN: ["Hanoi", "VN", 21.221, 105.807],
  TPE: ["Taipei", "TW", 25.077, 121.233], KHI: ["Karachi", "PK", 24.906, 67.161],
  LHE: ["Lahore", "PK", 31.522, 74.404], ISB: ["Islamabad", "PK", 33.561, 72.826],
  DAC: ["Dhaka", "BD", 23.843, 90.398], CMB: ["Colombo", "LK", 7.18, 79.884],
};

const COUNTRY_NAMES: Record<string, string> = {
  GB: "United Kingdom", IE: "Ireland", FR: "France", DE: "Germany", NL: "Netherlands",
  BE: "Belgium", LU: "Luxembourg", CH: "Switzerland", AT: "Austria", IT: "Italy",
  ES: "Spain", PT: "Portugal", GR: "Greece", MT: "Malta", CY: "Cyprus", DK: "Denmark",
  SE: "Sweden", NO: "Norway", FI: "Finland", IS: "Iceland", PL: "Poland", CZ: "Czechia",
  SK: "Slovakia", HU: "Hungary", RO: "Romania", BG: "Bulgaria", HR: "Croatia",
  SI: "Slovenia", RS: "Serbia", BA: "Bosnia and Herzegovina", TR: "Turkey",
  US: "United States", CA: "Canada", MX: "Mexico", BR: "Brazil", AR: "Argentina",
  CO: "Colombia", PE: "Peru", CL: "Chile", JP: "Japan", KR: "South Korea", CN: "China",
  HK: "Hong Kong", SG: "Singapore", TH: "Thailand", IN: "India", AE: "United Arab Emirates",
  QA: "Qatar", SA: "Saudi Arabia", IL: "Israel", ZA: "South Africa", EG: "Egypt",
  KE: "Kenya", NG: "Nigeria", MA: "Morocco", AU: "Australia", NZ: "New Zealand",
  PH: "Philippines", ID: "Indonesia", MY: "Malaysia", VN: "Vietnam", TW: "Taiwan",
  PK: "Pakistan", BD: "Bangladesh", LK: "Sri Lanka",
};

/** EU + EEA + Switzerland (EU261 territory). UK is handled separately under UK261. */
const EU_TERRITORY = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "CH",
]);
const UK = "GB";

export const DISCLAIMER =
  "Informational self-help based on Regulation (EC) No 261/2004 and UK air passenger rights; not legal advice. Airline practice and national courts can vary.";

export function findAirport(iata: string): Airport | null {
  const code = iata.trim().toUpperCase();
  const row = AIRPORT_DATA[code];
  if (!row) return null;
  return { iata: code, city: row[0], country: row[1], lat: row[2], lon: row[3] };
}

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export interface Band {
  name: "short" | "medium" | "long";
  maxKm: number;
  euEur: number;
  ukGbp: number;
  careAfterHours: number;
}

export function bandFor(km: number): Band {
  if (km <= 1500) return { name: "short", maxKm: 1500, euEur: 250, ukGbp: 220, careAfterHours: 2 };
  if (km <= 3500) return { name: "medium", maxKm: 3500, euEur: 400, ukGbp: 350, careAfterHours: 3 };
  return { name: "long", maxKm: Infinity, euEur: 600, ukGbp: 520, careAfterHours: 4 };
}

export interface Jurisdiction {
  scheme: "EU261" | "UK261" | "none";
  reason: string;
}

export function resolveJurisdiction(departureCountry: string, arrivalCountry: string, carrierCountry?: string): Jurisdiction {
  const dep = departureCountry.toUpperCase();
  const arr = arrivalCountry.toUpperCase();
  const carrier = carrierCountry?.toUpperCase();

  if (dep === UK) {
    return { scheme: "UK261", reason: `Flight departs the UK (${countryName(dep)}), so UK261 applies to any carrier.` };
  }
  if (EU_TERRITORY.has(dep)) {
    return { scheme: "EU261", reason: `Flight departs EU/EEA territory (${countryName(dep)}), so EU261 applies to any carrier.` };
  }
  if (arr === UK) {
    if (carrier === UK) return { scheme: "UK261", reason: "Flight arrives in the UK on a UK carrier, so UK261 applies." };
    return { scheme: "none", reason: "Arrival in the UK on a non-UK carrier is outside UK261 (departure was outside the UK)." };
  }
  if (EU_TERRITORY.has(arr)) {
    if (carrier && EU_TERRITORY.has(carrier)) {
      return { scheme: "EU261", reason: `Flight arrives in EU/EEA territory on an EU/EEA carrier (${countryName(carrier)}), so EU261 applies.` };
    }
    if (!carrier) {
      return { scheme: "none", reason: "Arrival in the EU on an unknown carrier: EU261 applies only if the carrier is an EU/EEA airline. Re-check with the carrier's country (e.g. DE, FR, IE)." };
    }
    return { scheme: "none", reason: `Arrival in the EU on a non-EU carrier (${countryName(carrier)}) is outside EU261; national rules or the Montreal Convention may still help.` };
  }
  return { scheme: "none", reason: "Neither departure nor arrival is in EU/EEA/UK territory, so EU261/UK261 compensation does not apply." };
}

export type ReasonCategory =
  | "unknown" | "weather" | "atc" | "security" | "political"
  | "strike_atc" | "strike_airline" | "technical" | "crew" | "other";

export interface ReasonAssessment {
  category: ReasonCategory;
  exempt: boolean | "possibly" | "unknown";
  note: string;
}

export function assessReason(category: ReasonCategory): ReasonAssessment {
  switch (category) {
    case "weather":
      return { category, exempt: true, note: "Severe weather is an extraordinary circumstance: care is still owed, but compensation is usually not." };
    case "atc":
      return { category, exempt: true, note: "Air-traffic-control restrictions are extraordinary: no compensation, care still owed." };
    case "security":
      return { category, exempt: true, note: "Security incidents are extraordinary: no compensation, care still owed." };
    case "political":
      return { category, exempt: true, note: "Political instability/closure of airspace is extraordinary: no compensation, care still owed." };
    case "strike_atc":
      return { category, exempt: true, note: "Strikes by ATC or other third parties are extraordinary: no compensation, care still owed." };
    case "strike_airline":
      return { category, exempt: false, note: "Strikes by the airline's own staff are NOT extraordinary (case law): compensation is still due." };
    case "technical":
      return { category, exempt: false, note: "Technical faults are inherent to running an airline (Wallentin-Hermann, C-549/07): compensation is still due." };
    case "crew":
      return { category, exempt: "possibly", note: "Crew illness can be extraordinary when the airline proves it could not be avoided (C-294/22): may be exempt, case-by-case." };
    case "other":
      return { category, exempt: false, note: "No recognised extraordinary circumstance: assume compensation is due and argue the facts." };
    default:
      return { category: "unknown", exempt: "unknown", note: "Reason unknown: ask the airline for the disruption cause in writing." };
  }
}

export function routeDistanceKm(departureCode: string, arrivalCode: string): { km: number | null; departure: Airport | null; arrival: Airport | null } {
  const departure = findAirport(departureCode);
  const arrival = findAirport(arrivalCode);
  if (!departure || !arrival) return { km: null, departure, arrival };
  return { km: haversineKm(departure.lat, departure.lon, arrival.lat, arrival.lon), departure, arrival };
}

export interface CheckInput {
  departure: string;
  arrival: string;
  disrupted: "delayed" | "cancelled";
  arrival_delay_hours?: number;
  notice_days?: number;
  rerouted?: boolean;
  reroute_arrival_delay_hours?: number;
  reason_category?: ReasonCategory;
  carrier_country?: string;
  distance_km?: number;
}

export interface CheckOutput {
  scheme: "EU261" | "UK261" | "none";
  jurisdiction_reason: string;
  route: { departure: string; arrival: string; departure_country?: string; arrival_country?: string };
  distance_km: number;
  band: string;
  compensation: { eligible: boolean | "possibly"; amount: number | null; currency: "EUR" | "GBP" | null; note: string };
  care_rights: { due: boolean; items: string[]; note: string };
  reason: ReasonAssessment;
  next_steps: string[];
  disclaimer: string;
}

export function checkCompensation(input: CheckInput): CheckOutput {
  const dep = findAirport(input.departure);
  const arr = findAirport(input.arrival);
  if (!dep) throw new Error(`unknown departure airport '${input.departure}'. Use an IATA code like LHR, CDG, JFK (or pass distance_km).`);
  if (!arr) throw new Error(`unknown arrival airport '${input.arrival}'. Use an IATA code like LHR, CDG, JFK (or pass distance_km).`);

  const km = input.distance_km ?? haversineKm(dep.lat, dep.lon, arr.lat, arr.lon);
  if (!Number.isFinite(km) || km <= 0) throw new Error("distance_km must be a positive number when supplied.");

  const band = bandFor(km);
  const jurisdiction = resolveJurisdiction(dep.country, arr.country, input.carrier_country);
  const reason = assessReason(input.reason_category ?? "unknown");
  const scheme = jurisdiction.scheme;

  const departureDelay = input.arrival_delay_hours ?? 0;
  const careTriggered = input.disrupted === "cancelled" || departureDelay >= band.careAfterHours;
  const careItems = [
    "meals and refreshments in reasonable relation to the waiting time",
    "hotel + transport between airport and hotel when an overnight stay becomes necessary",
    "two free calls, emails or fax messages",
  ];

  let eligible: boolean | "possibly" = false;
  let amount: number | null = null;
  let note = "";

  if (scheme === "none") {
    note = "No EU261/UK261 compensation on this route. Check the airline's own policy and the Montreal Convention for delay damages.";
  } else if (reason.exempt === true) {
    note = `Extraordinary circumstance (${reason.category}) - no compensation, though care is still owed.`;
  } else if (input.disrupted === "delayed") {
    if (departureDelay >= 3) {
      eligible = reason.exempt === "possibly" || reason.exempt === "unknown" ? "possibly" : true;
      amount = scheme === "EU261" ? band.euEur : band.ukGbp;
      note = `Arrival delayed ${departureDelay}h (>= 3h) - compensation due under ${scheme}.`;
    } else {
      note = `Arrival delay ${departureDelay}h is under the 3-hour threshold - no fixed compensation.`;
    }
  } else {
    const notice = input.notice_days ?? 0;
    if (notice >= 14) {
      note = "Cancelled with at least 14 days' notice - no fixed compensation (care and refund/rebooking rights still apply).";
    } else if (input.rerouted && (input.reroute_arrival_delay_hours ?? 0) <= band.careAfterHours + (band.name === "short" ? 0 : band.name === "medium" ? 1 : 2)) {
      note = "Re-routed with an arrival close to the original schedule - no fixed compensation.";
    } else {
      eligible = reason.exempt === "possibly" || reason.exempt === "unknown" ? "possibly" : true;
      amount = scheme === "EU261" ? band.euEur : band.ukGbp;
      note = `Cancelled with ${notice} days' notice - compensation due under ${scheme} unless the airline proves extraordinary circumstances.`;
    }
  }

  if (eligible === "possibly" && reason.exempt === "unknown") {
    note += " The disruption reason is unknown - ask the airline in writing; eligibility is likely but not certain.";
  }
  if (eligible === "possibly" && reason.exempt === "possibly") {
    note += " Crew-illness exemption is fact-specific; many claims still succeed - file and let the airline prove it.";
  }

  const nextSteps = [
    "Save your boarding pass, booking confirmation and any delay/cancellation messages from the airline.",
    "Request the disruption reason in writing from the airline (email or complaint form).",
    scheme === "none"
      ? "If the airline refuses, escalate per the airline's own policy or under the Montreal Convention."
      : "File a written claim with the airline (use generate_claim_letter) and keep proof of sending.",
    scheme === "UK261"
      ? "If unresolved in 8 weeks: escalate to CEDR or the Civil Aviation Authority (CAA)."
      : "If unresolved in 8 weeks: escalate to the national enforcement body of the departure country or an ADR scheme.",
  ];

  return {
    scheme,
    jurisdiction_reason: jurisdiction.reason,
    route: {
      departure: `${dep.iata} (${dep.city}, ${countryName(dep.country)})`,
      arrival: `${arr.iata} (${arr.city}, ${countryName(arr.country)})`,
      departure_country: dep.country,
      arrival_country: arr.country,
    },
    distance_km: km,
    band: band.name,
    compensation: { eligible, amount, currency: scheme === "EU261" ? "EUR" : scheme === "UK261" ? "GBP" : null, note },
    care_rights: { due: careTriggered, items: careTriggered ? careItems : [], note: careTriggered ? `Care is due from ${band.careAfterHours}h delay (band: ${band.name}).` : `Care rights start at ${band.careAfterHours}h of delay for this distance band.` },
    reason,
    next_steps: nextSteps,
    disclaimer: DISCLAIMER,
  };
}

export function compensationTable(): object {
  return {
    rules: [
      { band: "short", distance: "up to 1,500 km", eu_eur: 250, uk_gbp: 220, care_from: "2h delay" },
      { band: "medium", distance: "1,500-3,500 km", eu_eur: 400, uk_gbp: 350, care_from: "3h delay" },
      { band: "long", distance: "over 3,500 km", eu_eur: 600, uk_gbp: 520, care_from: "4h delay" },
    ],
    eligibility_summary: [
      "Arrival delay of 3+ hours at the final destination (delays, not just cancellations).",
      "Cancellation with less than 14 days' notice (unless re-routed close to the original schedule).",
      "Denied boarding due to overbooking (unless volunteers were sought and you accepted).",
      "Extraordinary circumstances exempt the airline (severe weather, ATC restrictions, security, third-party strikes) - care is still owed.",
      "Technical faults and the airline's own-staff strikes are NOT extraordinary: compensation is still due.",
      "Departures from the EU/EEA/CH: any carrier. Arrivals into the EU/EEA: EU/EEA carriers only. UK: UK261 mirrors the same structure.",
    ],
    claim_windows: "No EU-wide deadline; national time limits usually run 2-6 years. UK: 6 years (England/Wales), 5 years (Scotland). File as early as you can.",
    disclaimer: DISCLAIMER,
  };
}

export interface RightsInput {
  departure: string;
  arrival: string;
  disrupted: "delayed" | "cancelled" | "denied_boarding";
  arrival_delay_hours?: number;
  notice_days?: number;
}

export function disruptionRights(input: RightsInput): object {
  const dep = findAirport(input.departure);
  const arr = findAirport(input.arrival);
  const km = dep && arr ? haversineKm(dep.lat, dep.lon, arr.lat, arr.lon) : null;
  const band = km ? bandFor(km) : null;
  const rights: string[] = [];

  if (input.disrupted === "cancelled") {
    rights.push("Refund of the ticket within 7 days, OR re-routing to your final destination at the earliest opportunity (your choice).");
    rights.push("Care (meals, hotel if needed) while you wait for re-routing.");
  }
  if (input.disrupted === "delayed" && (input.arrival_delay_hours ?? 0) >= 5) {
    rights.push("If the delay reaches 5 hours and you no longer wish to travel: full refund of the ticket within 7 days.");
  }
  if (input.disrupted === "denied_boarding") {
    rights.push("Volunteers must be sought first; if involuntarily denied: compensation + refund or re-routing + care.");
  }
  rights.push(...(band ? [`Care from ${band.careAfterHours}h of delay for this ${band.name}-haul route (meals, hotel if overnight, two communications).`] : ["Care rights depend on the route distance (2h/3h/4h bands)."]));
  rights.push("Compensation (if due) must be paid within 14 days, in cash or by bank transfer at the airline's choice - not as a voucher unless you accept it.");

  return {
    disrupted: input.disrupted,
    distance_km: km,
    band: band?.name ?? "unknown",
    entitled_rights: rights,
    complaint_path: [
      "Complain to the airline first (keep proof of sending).",
      "No response in 8 weeks or a refusal: escalate to the national enforcement body (EU), CEDR/CAA (UK), or an approved ADR scheme.",
      "Last resort: small claims court in the airline's jurisdiction (claims under ~£10,000 are usually consumer-friendly).",
    ],
    disclaimer: DISCLAIMER,
  };
}

export interface TimelineInput {
  flight_date: string;
  scheme: "EU261" | "UK261";
}

export function claimTimeline(input: TimelineInput): object {
  const d = new Date(`${input.flight_date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error("flight_date must be YYYY-MM-DD.");
  const months = new Date(d);
  months.setUTCMonth(months.getUTCMonth() + 12);
  const recommendedBy = months.toISOString().slice(0, 10);

  return {
    flight_date: input.flight_date,
    scheme: input.scheme,
    recommended_action_by: recommendedBy,
    window_guidance:
      input.scheme === "UK261"
        ? "UK: 6 years in England/Wales/Northern Ireland (5 years in Scotland) - but evidence and memory decay, so claim now."
        : "EU: no EU-wide deadline; national time limits typically run 2-6 years depending on where you file. Act early.",
    evidence_checklist: [
      "Boarding pass or booking confirmation with the flight number and date.",
      "Proof of the disruption: airline messages, airport screens, or a written reason from the airline.",
      "Proof of arrival delay: actual arrival time (flight-tracker screenshot or stamp).",
      "Any receipts for care you paid yourself (meals, hotel, taxis) which the airline should reimburse.",
    ],
    disclaimer: DISCLAIMER,
  };
}

export interface LetterInput {
  passenger_name: string;
  airline_name: string;
  flight_number: string;
  flight_date: string;
  departure: string;
  arrival: string;
  incident_summary?: string;
  claimed_amount?: number;
  currency?: "EUR" | "GBP";
  booking_reference?: string;
  scheme?: "EU261" | "UK261";
}

export function generateClaimLetter(input: LetterInput): object {
  const dep = findAirport(input.departure);
  const arr = findAirport(input.arrival);
  const route = dep && arr ? `${dep.iata} (${dep.city}) to ${arr.iata} (${arr.city})` : `${input.departure.toUpperCase()} to ${input.arrival.toUpperCase()}`;
  const scheme = input.scheme ?? (dep?.country === UK ? "UK261" : "EU261");
  const amount = input.claimed_amount ?? 250;
  const currency = input.currency ?? (scheme === "UK261" ? "GBP" : "EUR");
  const bookingLine = input.booking_reference ? `Booking reference: ${input.booking_reference}\n` : "";
  const incident =
    input.incident_summary?.trim() ||
    `the flight was disrupted and arrived significantly late at the final destination`;

  const legalBasis = scheme === "UK261"
    ? "Regulation (EC) No 261/2004 as retained in UK law by the Air Passenger Rights and Air Travel Organisers' Licensing (Amendment) (EU Exit) Regulations 2019"
    : "Regulation (EC) No 261/2004 of the European Parliament and of the Council";

  const letter = `Dear ${input.airline_name} Customer Relations,

Subject: Formal claim for flight compensation - ${input.flight_number} on ${input.flight_date} (${route})

I am writing to claim compensation under ${legalBasis}.

Passenger: ${input.passenger_name}
Flight: ${input.flight_number} on ${input.flight_date}, ${route}
${bookingLine}Incident: ${incident}.

Under ${scheme === "UK261" ? "UK261" : "Article 7 of the Regulation"}, passengers whose flights are cancelled, delayed by three hours or more at the final destination, or who are denied boarding are entitled to fixed compensation, unless the airline can prove extraordinary circumstances that could not have been avoided.

I understand the applicable compensation for this route to be ${currency} ${amount}, and I request payment within 14 days as required by the Regulation.

If you believe an exemption applies, please provide the specific disruption cause in writing, with supporting evidence, rather than a general statement.

If this claim is not resolved satisfactorily, I intend to escalate it to ${scheme === "UK261" ? "the Civil Aviation Authority / CEDR" : "the relevant national enforcement body or an approved ADR scheme"} and, if necessary, to pursue it through the courts. I keep all documents proving the disruption.

Please confirm receipt of this claim and respond by return.

Yours faithfully,
${input.passenger_name}
`;

  return {
    subject: `Formal claim for flight compensation - ${input.flight_number} on ${input.flight_date}`,
    scheme,
    claimed_amount: { value: amount, currency },
    letter,
    sending_tips: [
      "Send through the airline's official complaint form or a tracked email; keep a copy and delivery proof.",
      "Attach boarding pass/booking confirmation and evidence of the delay.",
      "Mark your calendar: if no substantive reply in 8 weeks, escalate (CAA/CEDR for UK, national enforcement body for EU).",
    ],
    disclaimer: DISCLAIMER,
  };
}
