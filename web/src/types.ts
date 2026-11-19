// Mirrors the JSON written by `windowseat` (schema "windowseat/1").

export type Side = "left" | "right";

export type TargetLight = "day" | "sunlit" | "alpenglow" | "twilight" | "dark";

/** [distance_km, azimuth_deg, elevation_deg, h_off_deg, v_off_deg, light of the target itself] */
export type SightingTuple = [number, number, number, number, number, TargetLight];

export interface SideSample {
  footprint: [number, number][]; // [lon, lat]
  ground_fraction: number;
  look_az: number;
  look_el: number;
  look_point: [number, number]; // where the centre of the window view meets the ground / horizon
  sun_in_window: boolean;
  sun_on_this_side: boolean;
  landmarks: string[];
  sightings: Record<string, SightingTuple>;
}

export interface Sample {
  t: number;
  lat: number;
  lon: number;
  alt_m: number;
  gs_ms: number;
  heading: number;
  pitch: number;
  bank: number;
  sun: { az: number; el: number; visible: boolean; light: string };
  horizon_km: number;
  sides: Record<Side, SideSample>;
}

export interface LandmarkInfo {
  name: string;
  kind: string;
  lat: number;
  lon: number;
  elevation_m: number;
  weight: number;
  population: number | null;
  country: string | null;
  region?: string | null;
}

export interface LandmarkRecord {
  id: string;
  samples?: number;
  side: Side;
  name: string;
  kind: string;
  first_t: number;
  last_t: number;
  min_dist_km: number;
  closest_t?: number;
  first_lit_t?: number | null;
  light?: Partial<Record<TargetLight, number>>;
  duration_s: number;
  score: number;
}

export interface SideSummary {
  seat: string;
  seats_from_window: number;
  fov_deg: [number, number];
  v_range_deg: [number, number];
  window_m?: [number, number];
  eye_distance_m?: number;
  over_wing: boolean;
  landmarks: LandmarkRecord[];
  scenery_score: number;
  daylight_min: number;
  sun_in_window_min: number;
  sun_on_side_min: number;
}

export interface Result {
  schema: string;
  generator: string;
  flight: {
    flight_number?: string;
    airline?: string;
    origin_name?: string;
    destination_name?: string;
    aircraft_model?: string;
    registration?: string;
    times?: Partial<Record<"STD" | "ATD" | "STA" | "ETA" | "ATA", string>>;
    callsign: string | null;
    origin: string | null;
    destination: string | null;
    aircraft_type: string | null;
    aircraft_profile: string;
    source: string;
    start_t: number;
    end_t: number;
  };
  seat: { requested: string; label: string; side: Side; simple?: boolean };
  options: { step_s: number; visibility_km: number; refraction_k: number; terrain: string };
  track: [number, number, number][];
  samples: Sample[];
  landmarks: Record<string, LandmarkInfo>;
  summary: { left: SideSummary; right: SideSummary; recommended_side: Side };
}
